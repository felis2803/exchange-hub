import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { BitMex } from '../../../src/core/bitmex/index.js';
import { OrderStatus } from '../../../src/domain/order.js';
import { ValidationError } from '../../../src/infra/errors.js';

describe('BitMEX REST create order – limit/postOnly', () => {
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

  test('creates limit order with price and postOnly execInst', async () => {
    const { hub, core } = createCore();
    const mockFetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          orderID: 'lim-1',
          symbol: 'XBTUSD',
          ordStatus: 'New',
          ordType: 'Limit',
          orderQty: 10,
          price: 25_000,
          execInst: 'ParticipateDoNotInitiate',
        }),
        { status: 200 },
      ),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const response = await core.sell({
      symbol: 'XBTUSD',
      quantity: 10,
      type: 'limit',
      price: 25_000,
      postOnly: true,
      clientOrderId: 'limit-1',
    });

    expect(response.execInst).toBe('ParticipateDoNotInitiate');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [unknown, any];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      symbol: 'XBTUSD',
      side: 'Sell',
      orderQty: 10,
      ordType: 'Limit',
      price: 25_000,
      execInst: 'ParticipateDoNotInitiate',
      clOrdID: 'limit-1',
    });

    const stored = hub.orders.getByOrderId('lim-1');
    expect(stored).toBeDefined();
    const snapshot = stored!.getSnapshot();
    expect(snapshot.side).toBe('sell');
    expect(snapshot.price).toBe(25_000);
    expect(snapshot.execInst).toBe('ParticipateDoNotInitiate');
    expect(snapshot.status).toBe(OrderStatus.Placed);
  });

  test('maps reduceOnly and timeInForce to execInst/timeInForce', async () => {
    const { core } = createCore();
    const mockFetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          orderID: 'lim-2',
          symbol: 'XBTUSD',
          ordStatus: 'New',
          ordType: 'Limit',
          execInst: 'ParticipateDoNotInitiate,ReduceOnly',
          timeInForce: 'ImmediateOrCancel',
        }),
        { status: 200 },
      ),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const response = await core.buy({
      symbol: 'XBTUSD',
      quantity: 5,
      type: 'limit',
      price: 26_000,
      postOnly: true,
      reduceOnly: true,
      timeInForce: 'IOC',
    });

    expect(response.execInst).toBe('ParticipateDoNotInitiate,ReduceOnly');
    expect(response.timeInForce).toBe('ImmediateOrCancel');
    const [, init] = mockFetch.mock.calls[0] as [unknown, any];
    const body = JSON.parse(init.body as string);
    expect(body.execInst).toBe('ParticipateDoNotInitiate,ReduceOnly');
    expect(body.timeInForce).toBe('ImmediateOrCancel');
  });

  test('throws ValidationError when limit order has no price', async () => {
    const { core } = createCore();

    await expect(core.buy({ symbol: 'XBTUSD', quantity: 1, type: 'limit' })).rejects.toBeInstanceOf(
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
