import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { handleOrderMessage } from '../../../src/core/bitmex/channels/order.js';
import { buildCreatePayload, createOrder } from '../../../src/core/bitmex/rest/orders.js';
import { OrderStatus } from '../../../src/domain/order.js';
import { validatePlaceInput, type PreparedPlaceInput } from '../../../src/infra/validation.js';

import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { BitMexOrder } from '../../../src/core/bitmex/types.js';

const ORIGINAL_WEBSOCKET = global.WebSocket;

class StubWebSocket {
  public readonly url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

beforeAll(() => {
  (global as any).WebSocket = StubWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
  (global as any).WebSocket = ORIGINAL_WEBSOCKET;
});

function createHub() {
  const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
  const core = hub.Core as BitMex;
  return { hub, core };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('BitMEX trading – stop market lifecycle', () => {
  test('places stop-market order and processes trigger/fill events', async () => {
    const { hub, core } = createHub();
    const orders = hub.orders;

    handleOrderMessage(core, { table: 'order', action: 'partial', data: [] });

    const normalized = validatePlaceInput({
      symbol: 'XBTUSD',
      side: 'buy',
      size: 10,
      price: 30_500,
      type: 'Stop',
      opts: { clOrdID: 'cli-stop-1' },
      bestAsk: 30_000,
    });

    const prepared: PreparedPlaceInput = {
      ...normalized,
      options: { ...normalized.options, clOrdId: 'cli-stop-1' },
    };

    const expectedPayload = buildCreatePayload(prepared);
    expect(expectedPayload).toMatchObject({
      ordType: 'Stop',
      stopPx: 30_500,
      side: 'Buy',
    });
    expect(expectedPayload.price).toBeUndefined();

    const deferred = createDeferred<BitMexOrder>();
    const submit = jest.fn(() => deferred.promise);

    const orderPromise = createOrder({ orders, submit, now: () => 1_700_000_000_000 }, prepared);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual(expectedPayload);
    expect(orders.getInflightByClOrdId('cli-stop-1')).toBeDefined();

    deferred.resolve({
      orderID: 'ord-stop-1',
      clOrdID: 'cli-stop-1',
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 10,
      stopPx: 30_500,
      ordType: 'Stop',
      ordStatus: 'New',
      execType: 'New',
      leavesQty: 10,
      cumQty: 0,
      avgPx: 0,
      transactTime: '2024-01-01T00:00:00.000Z',
    });

    const order = await orderPromise;
    expect(order).toBeDefined();

    expect(orders.getInflightByClOrdId('cli-stop-1')).toBeUndefined();

    const snapshot = order.getSnapshot();
    expect(snapshot.status).toBe(OrderStatus.Placed);
    expect(snapshot.stopPrice).toBe(30_500);
    expect(snapshot.price).toBeNull();
    expect(snapshot.submittedAt).toBe(1_700_000_000_000);

    handleOrderMessage(core, {
      table: 'order',
      action: 'update',
      data: [
        {
          orderID: 'ord-stop-1',
          clOrdID: 'cli-stop-1',
          symbol: 'XBTUSD',
          ordStatus: 'Triggered',
          execType: 'New',
          stopPx: 30_500,
          timestamp: '2024-01-01T00:00:05.000Z',
        },
      ],
    });

    const afterTrigger = order.getSnapshot();
    expect(afterTrigger.status).toBe(OrderStatus.Placed);
    expect(afterTrigger.stopPrice).toBe(30_500);

    handleOrderMessage(core, {
      table: 'order',
      action: 'update',
      data: [
        {
          orderID: 'ord-stop-1',
          clOrdID: 'cli-stop-1',
          symbol: 'XBTUSD',
          ordStatus: 'Filled',
          execType: 'Trade',
          leavesQty: 0,
          cumQty: 10,
          avgPx: 30_520,
          lastQty: 10,
          lastPx: 30_520,
          transactTime: '2024-01-01T00:00:10.000Z',
        },
      ],
    });

    const afterFill = order.getSnapshot();
    expect(afterFill.status).toBe(OrderStatus.Filled);
    expect(afterFill.filledQty).toBe(10);
    expect(afterFill.avgFillPrice).toBe(30_520);
    expect(afterFill.stopPrice).toBe(30_500);
  });
});
