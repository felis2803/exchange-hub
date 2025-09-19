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

describe('BitMEX trading – stop-limit flag', () => {
  test('upgrades to stop-limit and reconciles race with private update', async () => {
    const { hub, core } = createHub();
    const orders = hub.orders;

    handleOrderMessage(core, { table: 'order', action: 'partial', data: [] });

    const normalized = validatePlaceInput({
      symbol: 'XBTUSD',
      side: 'sell',
      size: 5,
      price: 24_900,
      type: 'Stop',
      opts: { clOrdID: 'cli-stop-limit-1', stopLimitPrice: 24_850 },
      bestBid: 25_000,
    });

    const prepared: PreparedPlaceInput = {
      ...normalized,
      options: { ...normalized.options, clOrdId: 'cli-stop-limit-1' },
    };

    expect(prepared.type).toBe('StopLimit');

    const expectedPayload = buildCreatePayload(prepared);
    expect(expectedPayload).toMatchObject({
      ordType: 'StopLimit',
      price: 24_850,
      stopPx: 24_900,
      side: 'Sell',
    });

    const deferred = createDeferred<BitMexOrder>();
    const submit = jest.fn(() => deferred.promise);

    const orderPromise = createOrder({ orders, submit, now: () => 1_700_000_100_000 }, prepared);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual(expectedPayload);

    handleOrderMessage(core, {
      table: 'order',
      action: 'insert',
      data: [
        {
          orderID: 'ord-stop-limit-1',
          clOrdID: 'cli-stop-limit-1',
          symbol: 'XBTUSD',
          side: 'Sell',
          orderQty: 5,
          price: 24_850,
          stopPx: 24_900,
          ordType: 'StopLimit',
          ordStatus: 'New',
          execType: 'New',
          leavesQty: 5,
          cumQty: 0,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const orderFromWs = orders.getByOrderId('ord-stop-limit-1');
    expect(orderFromWs).toBeDefined();

    deferred.resolve({
      orderID: 'ord-stop-limit-1',
      clOrdID: 'cli-stop-limit-1',
      symbol: 'XBTUSD',
      side: 'Sell',
      orderQty: 5,
      price: 24_850,
      stopPx: 24_900,
      ordType: 'StopLimit',
      ordStatus: 'New',
      execType: 'New',
      leavesQty: 5,
      cumQty: 0,
      avgPx: 0,
      transactTime: '2024-01-01T00:00:01.000Z',
    });

    const order = await orderPromise;
    expect(order).toBe(orderFromWs);

    const snapshot = order.getSnapshot();
    expect(snapshot.type).toBe('StopLimit');
    expect(snapshot.price).toBe(24_850);
    expect(snapshot.stopPrice).toBe(24_900);
    expect(snapshot.status).toBe(OrderStatus.Placed);
    expect(snapshot.submittedAt).toBe(1_700_000_100_000);
    expect(orders.getInflightByClOrdId('cli-stop-limit-1')).toBeUndefined();

    handleOrderMessage(core, {
      table: 'order',
      action: 'update',
      data: [
        {
          orderID: 'ord-stop-limit-1',
          clOrdID: 'cli-stop-limit-1',
          symbol: 'XBTUSD',
          ordStatus: 'Filled',
          execType: 'Trade',
          leavesQty: 0,
          cumQty: 5,
          avgPx: 24_860,
          lastQty: 5,
          lastPx: 24_860,
          transactTime: '2024-01-01T00:00:10.000Z',
        },
      ],
    });

    const afterFill = order.getSnapshot();
    expect(afterFill.status).toBe(OrderStatus.Filled);
    expect(afterFill.filledQty).toBe(5);
    expect(afterFill.avgFillPrice).toBe(24_860);
  });
});
