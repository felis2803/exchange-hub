import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub.js';
import type { BitMex } from '../../../src/core/bitmex/index.js';
import { Instrument } from '../../../src/domain/instrument.js';
import { ValidationError } from '../../../src/infra/errors.js';

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

describe('BitMEX REST create order – limit & postOnly orders', () => {
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

  test('maps limit sell with postOnly/reduceOnly flags to execInst', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(JSON.stringify({ orderID: 'limit-1', symbol: 'XBTUSD' }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.sell(25, 65_000, {
      clOrdID: 'limit-001',
      postOnly: true,
      reduceOnly: true,
      timeInForce: 'GoodTillCancel',
    });

    const response = await core.sell(prepared);

    expect(response.orderID).toBe('limit-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      symbol: 'XBTUSD',
      side: 'Sell',
      orderQty: 25,
      ordType: 'Limit',
      price: 65_000,
      clOrdID: 'limit-001',
      execInst: 'ParticipateDoNotInitiate,ReduceOnly',
      timeInForce: 'GoodTillCancel',
    });
  });

  test('maps reduceOnly flag to execInst without postOnly', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(JSON.stringify({ orderID: 'limit-2', symbol: 'XBTUSD' }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.sell(10, 64_000, {
      clOrdID: 'limit-002',
      reduceOnly: true,
    });

    const response = await core.sell(prepared);

    expect(response.orderID).toBe('limit-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(init?.body as string);
    expect(body.execInst).toBe('ReduceOnly');
    expect(body).not.toHaveProperty('timeInForce');
  });

  test('throws ValidationError when sell() input carries buy side', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { core } = createCore();
    const instrument = new Instrument({ symbolNative: 'XBTUSD', symbolUni: 'btcusdt' });
    const prepared = instrument.buy(10, 64_500, { clOrdID: 'limit-002' });

    await expect(core.sell(prepared)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
