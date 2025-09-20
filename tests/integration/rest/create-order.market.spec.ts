import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { OrderStatus } from '../../../src/domain/order.js';
import { RateLimitError } from '../../../src/infra/errors.js';

import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { PreparedPlaceInput } from '../../../src/infra/validation.js';

const ORIGINAL_FETCH = global.fetch;

function createPreparedMarketOrder(
  overrides: Partial<PreparedPlaceInput> = {},
): PreparedPlaceInput {
  return {
    symbol: 'XBTUSD',
    side: 'buy',
    size: 100,
    type: 'Market',
    price: null,
    stopPrice: null,
    options: {
      postOnly: false,
      reduceOnly: false,
      timeInForce: null,
      clOrdId: 'cli-1',
    },
    ...overrides,
  };
}

function createHub() {
  const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
  const core = hub.Core as BitMex;
  return { hub, core };
}

describe('BitMEX REST createOrder – market', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('submits market payload and stores order snapshot', async () => {
    const mockFetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            orderID: 'ord-1',
            clOrdID: 'cli-1',
            symbol: 'XBTUSD',
            side: 'Buy',
            orderQty: 100,
            ordType: 'Market',
            ordStatus: 'New',
            execType: 'New',
            leavesQty: 100,
            cumQty: 0,
            avgPx: 0,
            timestamp: '2024-01-01T00:00:00.000Z',
          }),
          { status: 200 },
        ),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { hub, core } = createHub();
    const prepared = createPreparedMarketOrder();

    const order = await core.buy(prepared);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('https://testnet.bitmex.com/api/v1/order');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['api-key']).toBe('key');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 100,
      ordType: 'Market',
      clOrdID: 'cli-1',
    });
    expect(body).not.toHaveProperty('price');

    const snapshot = order.getSnapshot();
    expect(snapshot.orderId).toBe('ord-1');
    expect(snapshot.status).toBe(OrderStatus.Placed);
    expect(snapshot.symbol).toBe('XBTUSD');
    expect(hub.orders.getByClOrdId('cli-1')).toBe(order);
    expect(hub.orders.getInflightByClOrdId('cli-1')).toBeUndefined();
  });

  test('retries once on network failure', async () => {
    const responses = [
      Promise.reject(new TypeError('network down')),
      Promise.resolve(
        new Response(
          JSON.stringify({
            orderID: 'ord-2',
            clOrdID: 'cli-2',
            symbol: 'XBTUSD',
            side: 'Buy',
            orderQty: 50,
            ordType: 'Market',
            ordStatus: 'New',
            execType: 'New',
            leavesQty: 50,
            cumQty: 0,
            avgPx: 0,
            timestamp: '2024-01-01T00:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    ];

    const mockFetch = jest.fn(() => responses.shift() as Promise<Response>);
    global.fetch = mockFetch as unknown as typeof fetch;

    const { core } = createHub();
    const prepared = createPreparedMarketOrder({
      options: { ...createPreparedMarketOrder().options, clOrdId: 'cli-2' },
    });

    const order = await core.buy(prepared);
    expect(order.getSnapshot().orderId).toBe('ord-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('retries once on exchange 5xx', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            orderID: 'ord-3',
            clOrdID: 'cli-3',
            symbol: 'XBTUSD',
            side: 'Buy',
            orderQty: 25,
            ordType: 'Market',
            ordStatus: 'New',
            execType: 'New',
            leavesQty: 25,
            cumQty: 0,
            avgPx: 0,
            timestamp: '2024-01-01T00:00:00.000Z',
          }),
          { status: 200 },
        ),
      );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { core } = createHub();
    const prepared = createPreparedMarketOrder({
      options: { ...createPreparedMarketOrder().options, clOrdId: 'cli-3' },
    });

    await core.buy(prepared);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('does not retry on 429', async () => {
    const mockFetch = jest.fn(
      async () =>
        new Response('Too many', {
          status: 429,
          headers: { 'Retry-After': '1' },
        }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { hub, core } = createHub();
    const prepared = createPreparedMarketOrder({
      options: { ...createPreparedMarketOrder().options, clOrdId: 'cli-4' },
    });

    await expect(core.buy(prepared)).rejects.toBeInstanceOf(RateLimitError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(hub.orders.getInflightByClOrdId('cli-4')).toBeUndefined();
  });

  test('shares inflight promise for the same clOrdId and returns cached order afterwards', async () => {
    const mockFetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  orderID: 'ord-5',
                  clOrdID: 'cli-5',
                  symbol: 'XBTUSD',
                  side: 'Buy',
                  orderQty: 10,
                  ordType: 'Market',
                  ordStatus: 'New',
                  execType: 'New',
                  leavesQty: 10,
                  cumQty: 0,
                  avgPx: 0,
                  timestamp: '2024-01-01T00:00:00.000Z',
                }),
                { status: 200 },
              ),
            );
          }, 0);
        }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { core } = createHub();
    const prepared = createPreparedMarketOrder({
      options: { ...createPreparedMarketOrder().options, clOrdId: 'cli-5' },
    });

    const first = core.buy(prepared);
    const second = core.buy(prepared);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [order1, order2] = await Promise.all([first, second]);
    expect(order1).toBe(order2);

    const third = await core.buy(prepared);
    expect(third).toBe(order1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('submits stop-market payload when requested', async () => {
    const mockFetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            orderID: 'stop-ord-1',
            clOrdID: 'cli-stop',
            symbol: 'XBTUSD',
            side: 'Sell',
            orderQty: 1,
            ordType: 'Stop',
            ordStatus: 'New',
            execType: 'New',
            stopPx: 62_000,
            leavesQty: 1,
            cumQty: 0,
            avgPx: 0,
            timestamp: '2024-01-01T00:00:00.000Z',
          }),
          { status: 200 },
        ),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { hub, core } = createHub();
    const prepared: PreparedPlaceInput = {
      symbol: 'XBTUSD',
      side: 'sell',
      size: 1,
      type: 'Stop',
      price: null,
      stopPrice: 62_000,
      options: {
        postOnly: false,
        reduceOnly: false,
        timeInForce: null,
        clOrdId: 'cli-stop',
      },
    };

    const order = await core.sell(prepared);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('https://testnet.bitmex.com/api/v1/order');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['api-key']).toBe('key');

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      symbol: 'XBTUSD',
      side: 'Sell',
      orderQty: 1,
      ordType: 'Stop',
      stopPx: 62_000,
      clOrdID: 'cli-stop',
    });
    expect(body).not.toHaveProperty('price');

    const snapshot = order.getSnapshot();
    expect(snapshot.status).toBe(OrderStatus.Placed);
    expect(snapshot.stopPrice).toBe(62_000);
    expect(hub.orders.getByClOrdId('cli-stop')).toBe(order);
  });
});
