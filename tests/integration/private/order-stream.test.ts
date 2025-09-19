import { ExchangeHub } from '../../../src/ExchangeHub.js';
import {
  handleOrderMessage,
  markOrderChannelAwaitingSnapshot,
} from '../../../src/core/bitmex/channels/order.js';
import { OrderStatus } from '../../../src/domain/order.js';

import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { BitMexOrder } from '../../../src/core/bitmex/types.js';
import type { Settings } from '../../../src/types.js';

class FakeWebSocket {
  public readonly url: string;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(url: string) {
    this.url = url;
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
    this.#emit('close');
  }

  simulateOpen(): void {
    this.#emit('open');
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data });
    this.#emit('message', { data });
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

beforeAll(() => {
  (globalThis as any).WebSocket = FakeWebSocket;
});

afterAll(() => {
  (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
});

function createHub(settings: Partial<Settings> = {}) {
  const hub = new ExchangeHub('BitMex', { isTest: true, ...settings });
  const core = hub.Core as BitMex;

  return { hub, core };
}

describe('BitMEX private order stream', () => {
  test('handles lifecycle, fills, and resynchronization', () => {
    const { hub, core } = createHub();
    const store = hub.orders;

    const partial: BitMexOrder[] = [
      {
        orderID: 'ord-1',
        clOrdID: 'cli-1',
        symbol: 'XBTUSD',
        side: 'Buy',
        orderQty: 100,
        price: 50_000,
        leavesQty: 100,
        cumQty: 0,
        avgPx: 0,
        ordStatus: 'New',
        execType: 'New',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
      {
        orderID: 'ord-2',
        clOrdID: 'cli-2',
        symbol: 'XBTUSD',
        side: 'Sell',
        orderQty: 50,
        price: 50_100,
        leavesQty: 50,
        cumQty: 0,
        avgPx: 0,
        ordStatus: 'New',
        execType: 'New',
        timestamp: '2024-01-01T00:00:05.000Z',
      },
    ];

    handleOrderMessage(core, { table: 'order', action: 'partial', data: partial });

    expect(store.getByOrderId('ord-1')).toBeDefined();
    expect(store.getByOrderId('ord-2')).toBeDefined();
    expect(store.getActiveBySymbol('XBTUSD')).toHaveLength(2);

    const firstFill: BitMexOrder[] = [
      {
        orderID: 'ord-1',
        symbol: 'XBTUSD',
        side: 'Buy',
        orderQty: 100,
        leavesQty: 60,
        cumQty: 40,
        avgPx: 50_010,
        execID: 'exec-1',
        execType: 'Trade',
        ordStatus: 'PartiallyFilled',
        lastQty: 40,
        lastPx: 50_010,
        lastLiquidityInd: 'AddedLiquidity',
        transactTime: '2024-01-01T00:00:10.000Z',
      },
    ];

    handleOrderMessage(core, { table: 'order', action: 'update', data: firstFill });

    const order1 = store.getByOrderId('ord-1');
    expect(order1).toBeDefined();
    let snapshot1 = order1!.getSnapshot();
    expect(snapshot1.status).toBe(OrderStatus.PartiallyFilled);
    expect(snapshot1.filledQty).toBe(40);
    expect(snapshot1.avgFillPrice).toBeCloseTo(50_010, 6);
    expect(snapshot1.executions).toHaveLength(1);
    expect(snapshot1.executions[0]?.execId).toBe('exec-1');
    expect(snapshot1.executions[0]?.liquidity).toBe('maker');

    const cancel: BitMexOrder[] = [
      {
        orderID: 'ord-2',
        symbol: 'XBTUSD',
        leavesQty: 0,
        cumQty: 0,
        avgPx: 0,
        ordStatus: 'Canceled',
        execType: 'Canceled',
        timestamp: '2024-01-01T00:00:12.000Z',
      },
    ];

    handleOrderMessage(core, { table: 'order', action: 'update', data: cancel });

    const order2 = store.getByOrderId('ord-2');
    expect(order2).toBeDefined();
    const snapshot2 = order2!.getSnapshot();
    expect(snapshot2.status).toBe(OrderStatus.Canceled);
    expect(store.getActiveBySymbol('XBTUSD')).toHaveLength(1);

    const finalFill: BitMexOrder[] = [
      {
        orderID: 'ord-1',
        symbol: 'XBTUSD',
        leavesQty: 0,
        cumQty: 100,
        avgPx: 50_020,
        execID: 'exec-2',
        execType: 'Trade',
        ordStatus: 'Filled',
        lastQty: 60,
        lastPx: 50_030,
        lastLiquidityInd: 'RemovedLiquidity',
        transactTime: '2024-01-01T00:00:20.000Z',
      },
    ];

    handleOrderMessage(core, { table: 'order', action: 'update', data: finalFill });

    snapshot1 = order1!.getSnapshot();
    expect(snapshot1.status).toBe(OrderStatus.Filled);
    expect(snapshot1.filledQty).toBe(100);
    expect(snapshot1.avgFillPrice).toBeCloseTo(50_020, 6);
    expect(snapshot1.executions).toHaveLength(2);
    expect(store.getActiveOrders()).toHaveLength(0);

    // duplicate update should be ignored by execId dedupe
    handleOrderMessage(core, { table: 'order', action: 'update', data: finalFill });
    const afterDuplicate = order1!.getSnapshot();
    expect(afterDuplicate.filledQty).toBe(100);
    expect(afterDuplicate.executions).toHaveLength(2);

    markOrderChannelAwaitingSnapshot(core);

    const ignoredUpdate: BitMexOrder[] = [
      {
        orderID: 'ord-1',
        symbol: 'XBTUSD',
        leavesQty: 0,
        cumQty: 110,
        avgPx: 50_025,
        execID: 'exec-ignored',
        execType: 'Trade',
        ordStatus: 'PartiallyFilled',
        lastQty: 10,
        lastPx: 50_040,
        transactTime: '2024-01-01T00:00:50.000Z',
      },
    ];

    handleOrderMessage(core, { table: 'order', action: 'update', data: ignoredUpdate });

    snapshot1 = order1!.getSnapshot();
    expect(snapshot1.filledQty).toBe(100);
    expect(snapshot1.executions).toHaveLength(2);

    const resync: BitMexOrder[] = [
      {
        orderID: 'ord-1',
        clOrdID: 'cli-1',
        symbol: 'XBTUSD',
        orderQty: 100,
        leavesQty: 0,
        cumQty: 100,
        avgPx: 50_020,
        ordStatus: 'Filled',
        execType: 'Trade',
        timestamp: '2024-01-01T00:01:00.000Z',
      },
    ];

    handleOrderMessage(core, { table: 'order', action: 'partial', data: resync });

    let resynced = order1!.getSnapshot();
    expect(resynced.status).toBe(OrderStatus.Filled);
    expect(resynced.filledQty).toBe(100);
    expect(resynced.avgFillPrice).toBeCloseTo(50_020, 6);
    expect(resynced.executions).toHaveLength(2);

    const postResyncUpdate: BitMexOrder[] = [
      {
        orderID: 'ord-1',
        symbol: 'XBTUSD',
        leavesQty: 0,
        cumQty: 100,
        avgPx: 50_020,
        ordStatus: 'Filled',
        execType: 'Restated',
        transactTime: '2024-01-01T00:01:05.000Z',
      },
    ];

    handleOrderMessage(core, { table: 'order', action: 'update', data: postResyncUpdate });

    resynced = order1!.getSnapshot();
    expect(resynced.filledQty).toBe(100);
    expect(resynced.avgFillPrice).toBeCloseTo(50_020, 6);

    expect(store.getByClOrdId('cli-1')).toBe(order1);
    expect(
      store
        .getBySymbol('XBTUSD')
        .map((order) => order.orderId)
        .sort(),
    ).toEqual(['ord-1', 'ord-2']);
  });
});
