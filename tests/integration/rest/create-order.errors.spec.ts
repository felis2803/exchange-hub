import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub.js';
import type { BitMex } from '../../../src/core/bitmex/index.js';
import { BITMEX_REST_ORDER_TIMEOUT_MS } from '../../../src/core/bitmex/constants.js';
import { Instrument } from '../../../src/domain/instrument.js';
import {
  NetworkError,
  OrderRejectedError,
  ValidationError,
} from '../../../src/infra/errors.js';

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

describe('BitMEX REST create order – validation & errors', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function createCore() {
    const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
    const core = hub.Core as BitMex;
    return { hub, core };
  }

  test('rejects market order carrying price before network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();

    const invalid: PreparedPlaceInput = {
      symbol: 'XBTUSD',
      side: 'buy',
      size: 1,
      type: 'Market',
      price: 10,
      stopPrice: null,
      options: {
        postOnly: false,
        reduceOnly: false,
        timeInForce: null,
        clOrdId: 'invalid-market-price',
      },
    };

    await expect(core.buy(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects limit order without price before network', async () => {
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
        clOrdId: 'invalid-limit-price',
      },
    };

    await expect(core.buy(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects market postOnly before network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();

    const invalid: PreparedPlaceInput = {
      symbol: 'XBTUSD',
      side: 'buy',
      size: 1,
      type: 'Market',
      price: null,
      stopPrice: null,
      options: {
        postOnly: true,
        reduceOnly: false,
        timeInForce: null,
        clOrdId: 'invalid-market-postonly',
      },
    };

    await expect(core.buy(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects postOnly combined with IOC before network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();

    const invalid: PreparedPlaceInput = {
      symbol: 'XBTUSD',
      side: 'sell',
      size: 1,
      type: 'Limit',
      price: 65_000,
      stopPrice: null,
      options: {
        postOnly: true,
        reduceOnly: false,
        timeInForce: 'IOC',
        clOrdId: 'invalid-postonly-ioc',
      },
    };

    await expect(core.sell(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects postOnly combined with FOK before network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();

    const invalid: PreparedPlaceInput = {
      symbol: 'XBTUSD',
      side: 'sell',
      size: 1,
      type: 'Limit',
      price: 65_000,
      stopPrice: null,
      options: {
        postOnly: true,
        reduceOnly: false,
        timeInForce: 'FillOrKill',
        clOrdId: 'invalid-postonly-fok',
      },
    };

    await expect(core.sell(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects stop order payload before network', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();

    const invalid: PreparedPlaceInput = {
      symbol: 'XBTUSD',
      side: 'sell',
      size: 1,
      type: 'Stop',
      price: 60_000,
      stopPrice: 60_000,
      options: {
        postOnly: false,
        reduceOnly: false,
        timeInForce: null,
        clOrdId: 'invalid-stop',
      },
    };

    await expect(core.sell(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('maps HTTP 400 responses to ValidationError with exchange message', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: 'Duplicate clOrdID', name: 'ValidationError' } }),
        { status: 400 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.buy(1, undefined, { clOrdID: 'duplicate-id' });

    await expect(core.buy(prepared)).rejects.toMatchObject({
      message: 'Duplicate clOrdID',
      category: 'VALIDATION_ERROR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('maps HTTP 409 responses to OrderRejectedError with exchange message', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: 'Order is not allowed', name: 'OrderRejectedError' } }),
        { status: 409 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.sell(2, 65_000, { clOrdID: 'reject-id' });

    await expect(
      core.sell(prepared).catch((error) => {
        expect(error).toBeInstanceOf(OrderRejectedError);
        expect(error).toMatchObject({
          message: 'Order is not allowed',
          category: 'ORDER_REJECTED',
        });
        throw error;
      }),
    ).rejects.toBeInstanceOf(OrderRejectedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('aborts when request times out and surfaces NetworkError', async () => {
    jest.useFakeTimers();

    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.buy(1, undefined, { clOrdID: 'timeout-1' });

    const promise = core.buy(prepared);
    const expectation = expect(promise).rejects.toBeInstanceOf(NetworkError);

    await jest.advanceTimersByTimeAsync(BITMEX_REST_ORDER_TIMEOUT_MS);
    await jest.advanceTimersByTimeAsync(200);
    await jest.advanceTimersByTimeAsync(BITMEX_REST_ORDER_TIMEOUT_MS);

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
