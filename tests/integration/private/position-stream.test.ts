import type { ExchangeHub as ExchangeHubClass } from '../../../src/ExchangeHub.js';
import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { BitMexPosition } from '../../../src/core/bitmex/types.js';
import type { PositionSnapshot } from '../../../src/domain/position.js';
import type { DomainUpdate } from '../../../src/core/types.js';

import { handlePositionInsert, handlePositionPartial, handlePositionUpdate } from '../../../src/core/bitmex/channels/position.js';
import { METRICS as PRIVATE_METRICS } from '../../../src/infra/metrics-private.js';

let metrics!: typeof import('../../../src/infra/metrics.js');

class ControlledWebSocket {
  static instances: ControlledWebSocket[] = [];

  public readonly url: string;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;
  public onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;

  #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(url: string) {
    this.url = url;
    ControlledWebSocket.instances.push(this);
  }

  addEventListener(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }

    this.#listeners.get(event)!.add(listener);
  }

  removeEventListener(event: string, listener: (...args: unknown[]) => void): void {
    this.#listeners.get(event)?.delete(listener);
  }

  send(_data: string): void {}

  close(): void {
    this.#emit('close', { code: 1000, reason: 'client-request' });
  }

  #emit(event: string, ...args: unknown[]): void {
    const handler = (this as any)[`on${event}`];

    if (typeof handler === 'function') {
      handler(...args);
    }

    for (const listener of this.#listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

const ORIGINAL_WEBSOCKET = (globalThis as any).WebSocket;

let ExchangeHub: typeof ExchangeHubClass;

beforeAll(async () => {
  jest.resetModules();
  (globalThis as any).WebSocket = ControlledWebSocket as any;
  metrics = await import('../../../src/infra/metrics.js');
  ({ ExchangeHub } = await import('../../../src/ExchangeHub.js'));
});

afterAll(() => {
  (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
});

beforeEach(() => {
  ControlledWebSocket.instances = [];
  metrics.resetMetrics();
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('BitMEX position stream', () => {
  test('partial → updates → reconnect keep state consistent and handles dedupe', () => {
    const incrementCounterSpy = jest.spyOn(metrics, 'incrementCounter');

    try {
      const hub = new ExchangeHub('BitMex', { isTest: true });
      const core = hub.Core as BitMex;

      const partialRows: BitMexPosition[] = [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 200,
          avgEntryPrice: 50_000,
          markPrice: 50_500,
          liquidationPrice: 45_000,
          marginCallPrice: 47_000,
          bankruptPrice: 44_000,
          leverage: 5,
          unrealisedPnl: 1_000,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          account: 101,
          symbol: 'ETHUSD',
          currentQty: -100,
          avgEntryPrice: 3_000,
          markPrice: 2_950,
          liquidationPrice: 3_200,
          marginCallPrice: 3_150,
          bankruptPrice: 3_300,
          leverage: 3,
          unrealisedPnl: -500,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ];

      handlePositionPartial(core, clone(partialRows));

      const xbtPosition = hub.positions.get('101', 'XBTUSD');
      const ethPosition = hub.positions.get('101', 'ETHUSD');

      expect(xbtPosition).toBeDefined();
      expect(ethPosition).toBeDefined();

      expect(hub.positions.active.map((position) => position.symbol)).toEqual(['XBTUSD', 'ETHUSD']);
      expect(hub.positions.bySymbol('XBTUSD')).toEqual([xbtPosition]);

      const xbtSnapshot = xbtPosition!.getSnapshot();
      expect(xbtSnapshot.side).toBe('buy');
      expect(xbtSnapshot.size).toBe(200);
      expect(xbtSnapshot.markPrice).toBe(50_500);
      expect(xbtSnapshot.timestamp).toBe('2024-01-01T00:00:00.000Z');
      expect(xbtSnapshot.symbol).toBe('XBTUSD');

      const xbtEvents: {
        snapshot: PositionSnapshot;
        diff: DomainUpdate<PositionSnapshot>;
        reason?: string;
      }[] = [];

      xbtPosition!.on('update', (snapshot, diff, reason) => {
        xbtEvents.push({ snapshot, diff, reason });
      });

      const updates: BitMexPosition[] = [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 240,
          markPrice: 50_650,
          unrealisedPnl: 1_200,
          timestamp: '2024-01-01T00:01:00.000Z',
        },
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 230,
          markPrice: 50_600,
          unrealisedPnl: 1_150,
          timestamp: '2024-01-01T00:01:30.000Z',
        },
        {
          account: 101,
          symbol: 'ETHUSD',
          currentQty: -80,
          markPrice: 2_975,
          unrealisedPnl: -300,
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ];

      handlePositionUpdate(core, clone(updates));

      expect(xbtEvents).toHaveLength(1);
      expect(xbtEvents[0].reason).toBe('update');
      expect(xbtEvents[0].diff.changed).toEqual(expect.arrayContaining(['currentQty', 'size', 'markPrice']));
      expect(xbtEvents[0].snapshot.currentQty).toBe(230);
      expect(xbtEvents[0].snapshot.size).toBe(230);
      expect(xbtEvents[0].snapshot.symbol).toBe('XBTUSD');

      const afterUpdate = xbtPosition!.getSnapshot();
      expect(afterUpdate.unrealisedPnl).toBe(1_150);
      expect(afterUpdate.timestamp).toBe('2024-01-01T00:01:30.000Z');

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 210,
          markPrice: 50_400,
          timestamp: '2023-12-31T23:59:00.000Z',
        },
      ]);

      expect(xbtPosition!.getSnapshot().currentQty).toBe(230);
      expect(xbtEvents).toHaveLength(1);

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 230,
          markPrice: 50_600,
          timestamp: '2024-01-01T00:01:30.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(1);

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'ETHUSD',
          currentQty: 0,
          markPrice: 2_980,
          timestamp: '2024-01-01T00:02:00.000Z',
        },
      ]);

      expect(hub.positions.get('101', 'ETHUSD')).toBeUndefined();
      expect(hub.positions.active.map((position) => position.symbol)).toEqual(['XBTUSD']);
      handlePositionInsert(core, [
        {
          account: 101,
          symbol: 'ADAUSD',
          currentQty: 50,
          markPrice: 0.5,
          timestamp: '2024-01-01T00:03:00.000Z',
        },
      ]);

      const adaPosition = hub.positions.get('101', 'ADAUSD');
      expect(adaPosition).toBeDefined();
      expect(adaPosition!.getSnapshot().currentQty).toBe(50);
      const reconnectPartial: BitMexPosition[] = [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 150,
          markPrice: 50_550,
          unrealisedPnl: 900,
          timestamp: '2024-01-01T00:05:00.000Z',
        },
        {
          account: 101,
          symbol: 'SOLUSD',
          currentQty: 30,
          markPrice: 100,
          timestamp: '2024-01-01T00:05:00.000Z',
        },
      ];

      handlePositionPartial(core, clone(reconnectPartial));

      expect(hub.positions.get('101', 'ADAUSD')).toBeUndefined();

      const solPosition = hub.positions.get('101', 'SOLUSD');
      expect(solPosition).toBeDefined();
      expect(solPosition!.getSnapshot().size).toBe(30);

      expect(xbtPosition!.getSnapshot().currentQty).toBe(150);
      expect(xbtEvents).toHaveLength(2);
      expect(xbtEvents[1].reason).toBe('partial');

      expect(incrementCounterSpy).toHaveBeenCalledTimes(9);
      expect(incrementCounterSpy.mock.calls).toEqual([
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'XBTUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'ETHUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'XBTUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'ETHUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'ETHUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'ADAUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'XBTUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'SOLUSD' },
        ],
        [
          PRIVATE_METRICS.positionUpdateCount,
          1,
          { env: 'testnet', table: 'position', symbol: 'ADAUSD' },
        ],
      ]);
    } finally {
      incrementCounterSpy.mockRestore();
    }
  });
});

