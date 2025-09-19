import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { BitMex } from '../../../src/core/bitmex/index.js';
import { OrderStatus } from '../../../src/domain/order.js';
import { RateLimitError, ValidationError } from '../../../src/infra/errors.js';

describe('BitMEX REST create order – market', () => {
  const ORIGINAL_WEBSOCKET = (globalThis as any).WebSocket;
  const ORIGINAL_FETCH = global.fetch;

  beforeAll(() => {
    (globalThis as any).WebSocket = NoopWebSocket as unknown as typeof WebSocket;
  });

  afterAll(() => {
    (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('creates market order with correct payload', async () => {
    const { hub, core } = createCore();
    const mockFetch = jest.fn(async (input: unknown) => {
      expect(String(input)).toBe('https://testnet.bitmex.com/api/v1/order');
      return new Response(
        JSON.stringify({
          orderID: 'mkt-1',
          symbol: 'XBTUSD',
          ordStatus: 'New',
          orderQty: 50,
          side: 'Buy',
        }),
        { status: 200 },
      );
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const response = await core.buy({
      symbol: 'XBTUSD',
      quantity: 50,
      type: 'market',
      clientOrderId: 'client-1',
    });

    expect(response.orderID).toBe('mkt-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [unknown, any];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 50,
      ordType: 'Market',
      clOrdID: 'client-1',
    });
    expect(body).not.toHaveProperty('price');

    const storedById = hub.orders.getByOrderId('mkt-1');
    expect(storedById).toBeDefined();
    const snapshot = storedById!.getSnapshot();
    expect(snapshot.symbol).toBe('XBTUSD');
    expect(snapshot.side).toBe('buy');
    expect(snapshot.status).toBe(OrderStatus.Placed);
    expect(snapshot.clOrdId).toBe('client-1');
  });

  test('retries once on exchange error and succeeds', async () => {
    const { core } = createCore();
    const responses = [
      new Response('Server error', { status: 503 }),
      new Response(JSON.stringify({ orderID: 'mkt-2', symbol: 'XBTUSD', ordStatus: 'New' }), {
        status: 200,
      }),
    ];
    const mockFetch = jest.fn(async () => responses.shift()!);
    global.fetch = mockFetch as unknown as typeof fetch;

    const response = await core.sell({ symbol: 'XBTUSD', quantity: 1, type: 'market' });

    expect(response.orderID).toBe('mkt-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('does not retry on 429', async () => {
    const { core } = createCore();
    const mockFetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Too many' } }), {
          status: 429,
          headers: { 'Retry-After': '5' },
        }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(core.buy({ symbol: 'XBTUSD', quantity: 1, type: 'market' })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('throws ValidationError for invalid combinations', async () => {
    const { core } = createCore();

    await expect(
      core.buy({ symbol: 'XBTUSD', quantity: 1, type: 'market', postOnly: true }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(core.sell({ symbol: 'XBTUSD', quantity: 0, type: 'market' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

function createCore() {
  const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
  const core = hub.Core as BitMex;
  return { hub, core };
}

class NoopWebSocket {
  onmessage: ((event: any) => void) | null = null;

  addEventListener() {}

  removeEventListener() {}

  close() {}

  send() {}
}
