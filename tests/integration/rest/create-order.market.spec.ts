import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub.js';
import type { BitMex } from '../../../src/core/bitmex/index.js';
import { Instrument } from '../../../src/domain/instrument.js';
import { RateLimitError, ValidationError } from '../../../src/infra/errors.js';

import type { PreparedPlaceInput } from '../../../src/infra/validation.js';

class FakeWebSocket {
  public readonly url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event?: unknown) => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

const ORIGINAL_WEBSOCKET = (globalThis as any).WebSocket;

beforeAll(() => {
  (globalThis as any).WebSocket = FakeWebSocket as unknown as typeof ORIGINAL_WEBSOCKET;
});

afterAll(() => {
  (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
});

describe('BitMEX REST create order – market orders', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createCore() {
    const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
    const core = hub.Core as BitMex;
    return { hub, core };
  }

  test('submits a market buy order with expected payload', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(JSON.stringify({ orderID: 'order-1', symbol: 'XBTUSD' }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.buy(100, undefined, { clOrdID: 'client-1' });

    const response = await core.buy(prepared);

    expect(response).toMatchObject({ orderID: 'order-1', symbol: 'XBTUSD' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('https://testnet.bitmex.com/api/v1/order');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json', accept: 'application/json' });
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 100,
      ordType: 'Market',
      clOrdID: 'client-1',
    });
  });

  test('retries once when fetch rejects with a network error', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orderID: 'order-2' }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.buy(5, undefined, { clOrdID: 'client-2' });

    const result = await core.buy(prepared);

    expect(result.orderID).toBe('order-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('retries once on HTTP 5xx responses', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('server error', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orderID: 'order-3' }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.buy(2, undefined, { clOrdID: 'client-3' });

    const result = await core.buy(prepared);

    expect(result.orderID).toBe('order-3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('does not retry on HTTP 429 responses', async () => {
    const fetchMock = jest.fn(async () => new Response('Too many', { status: 429 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.buy(3, undefined, { clOrdID: 'client-4' });

    await expect(core.buy(prepared)).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('throws ValidationError when prepared payload is inconsistent', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const invalid: PreparedPlaceInput = {
      symbol: 'XBTUSD',
      side: 'buy',
      size: 1,
      type: 'Limit',
      price: null,
      stopPrice: null,
      options: {
        postOnly: false,
        reduceOnly: false,
        timeInForce: null,
        clOrdId: 'client-invalid',
      },
    };

    await expect(core.buy(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
