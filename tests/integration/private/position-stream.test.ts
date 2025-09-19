import type { ExchangeHub as ExchangeHubClass } from '../../../src/ExchangeHub.js';
import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { BitMexPosition } from '../../../src/core/bitmex/types.js';
import type { PositionSnapshot } from '../../../src/domain/position.js';
import type { DomainUpdate } from '../../../src/core/types.js';

import {
  handlePositionInsert,
  handlePositionPartial,
  handlePositionUpdate,
  markPositionsAwaitingResync,
} from '../../../src/core/bitmex/channels/position.js';
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
  test('dedupe-out-of-order updates keep state consistent', () => {
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

      expect(hub.positions.activeArray().map((position) => position.symbol)).toEqual([
        'XBTUSD',
        'ETHUSD',
      ]);
      expect(hub.positions.bySymbolArray('XBTUSD')).toEqual([xbtPosition]);
      expect(hub.positions.bySymbolArray('ETHUSD')).toEqual([ethPosition]);

      const xbtEvents: {
        snapshot: PositionSnapshot;
        diff: DomainUpdate<PositionSnapshot>;
        reason?: string;
      }[] = [];

      xbtPosition!.on('update', (snapshot, diff, reason) => {
        xbtEvents.push({ snapshot, diff, reason });
      });

      handlePositionUpdate(core, [
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
          symbol: 'ETHUSD',
          currentQty: -80,
          markPrice: 2_975,
          unrealisedPnl: -300,
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(1);
      expect(xbtEvents[0].reason).toBe('update');
      expect(xbtEvents[0].snapshot.currentQty).toBe(240);
      expect(xbtPosition!.getSnapshot().timestamp).toBe('2024-01-01T00:01:00.000Z');

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 210,
          markPrice: 50_400,
          timestamp: '2023-12-31T23:59:00.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(1);

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 240,
          markPrice: 50_650,
          unrealisedPnl: 1_200,
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(1);

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 240,
          markPrice: 50_680,
          unrealisedPnl: 1_300,
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(2);
      expect(xbtEvents[1].snapshot.markPrice).toBe(50_680);

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 230,
          markPrice: 50_600,
          unrealisedPnl: 1_150,
          timestamp: '2024-01-01T00:01:30.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(3);
      expect(xbtEvents[2].snapshot.currentQty).toBe(230);
      expect(xbtPosition!.getSnapshot().timestamp).toBe('2024-01-01T00:01:30.000Z');

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
      expect(hub.positions.activeArray().map((position) => position.symbol)).toEqual(['XBTUSD']);

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

      const expectedSymbols = [
        'XBTUSD',
        'ETHUSD',
        'XBTUSD',
        'ETHUSD',
        'XBTUSD',
        'XBTUSD',
        'ETHUSD',
        'ADAUSD',
      ];

      expect(incrementCounterSpy).toHaveBeenCalledTimes(expectedSymbols.length);
      expect(incrementCounterSpy.mock.calls.map(([, , labels]) => labels.symbol)).toEqual(
        expectedSymbols,
      );
    } finally {
      incrementCounterSpy.mockRestore();
    }
  });

  test('reconnect-resync waits for partial before applying updates', () => {
    const incrementCounterSpy = jest.spyOn(metrics, 'incrementCounter');

    try {
      const hub = new ExchangeHub('BitMex', { isTest: true });
      const core = hub.Core as BitMex;

      const partialRows: BitMexPosition[] = [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 120,
          markPrice: 50_400,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          account: 101,
          symbol: 'ETHUSD',
          currentQty: -40,
          markPrice: 2_800,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ];

      handlePositionPartial(core, clone(partialRows));

      const xbtPosition = hub.positions.get('101', 'XBTUSD');
      expect(xbtPosition).toBeDefined();

      const xbtEvents: {
        snapshot: PositionSnapshot;
        diff: DomainUpdate<PositionSnapshot>;
        reason?: string;
      }[] = [];

      xbtPosition!.on('update', (snapshot, diff, reason) => {
        xbtEvents.push({ snapshot, diff, reason });
      });

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 150,
          markPrice: 50_550,
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(1);
      expect(xbtPosition!.getSnapshot().currentQty).toBe(150);

      const callsAfterInitialUpdate = incrementCounterSpy.mock.calls.length;

      markPositionsAwaitingResync(core);

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 180,
          markPrice: 50_600,
          timestamp: '2024-01-01T00:02:00.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(1);
      expect(incrementCounterSpy).toHaveBeenCalledTimes(callsAfterInitialUpdate);

      const reconnectPartial: BitMexPosition[] = [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 90,
          markPrice: 50_300,
          timestamp: '2024-01-01T00:03:00.000Z',
        },
        {
          account: 101,
          symbol: 'SOLUSD',
          currentQty: 30,
          markPrice: 100,
          timestamp: '2024-01-01T00:03:00.000Z',
        },
      ];

      handlePositionPartial(core, clone(reconnectPartial));

      expect(hub.positions.get('101', 'ETHUSD')).toBeUndefined();

      const solPosition = hub.positions.get('101', 'SOLUSD');
      expect(solPosition).toBeDefined();
      expect(solPosition!.getSnapshot().currentQty).toBe(30);

      expect(xbtPosition!.getSnapshot().currentQty).toBe(90);
      expect(xbtEvents).toHaveLength(2);
      expect(xbtEvents[1].reason).toBe('partial');

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'SOLUSD',
          currentQty: 35,
          markPrice: 102,
          timestamp: '2024-01-01T00:04:00.000Z',
        },
      ]);

      expect(hub.positions.get('101', 'SOLUSD')!.getSnapshot().currentQty).toBe(35);

      handlePositionUpdate(core, [
        {
          account: 101,
          symbol: 'XBTUSD',
          currentQty: 95,
          markPrice: 50_350,
          timestamp: '2024-01-01T00:04:30.000Z',
        },
      ]);

      expect(xbtEvents).toHaveLength(3);
      expect(xbtEvents[2].snapshot.currentQty).toBe(95);

      const expectedSymbols = [
        'XBTUSD',
        'ETHUSD',
        'XBTUSD',
        'XBTUSD',
        'SOLUSD',
        'ETHUSD',
        'SOLUSD',
        'XBTUSD',
      ];

      expect(incrementCounterSpy).toHaveBeenCalledTimes(expectedSymbols.length);
      expect(incrementCounterSpy.mock.calls.map(([, , labels]) => labels.symbol)).toEqual(
        expectedSymbols,
      );
    } finally {
      incrementCounterSpy.mockRestore();
    }
  });
});

