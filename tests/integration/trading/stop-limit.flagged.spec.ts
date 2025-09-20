import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { OrderStatus } from '../../../src/domain/order.js';

import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { PreparedPlaceInput } from '../../../src/infra/validation.js';

const ORIGINAL_FETCH = global.fetch;

function createPreparedStopLimitOrder(
  overrides: Partial<PreparedPlaceInput> = {},
): PreparedPlaceInput {
  const base: PreparedPlaceInput = {
    symbol: 'XBTUSD',
    side: 'buy',
    size: 25,
    type: 'StopLimit',
    price: 50_150,
    stopPrice: 50_200,
    options: {
      postOnly: false,
      reduceOnly: false,
      timeInForce: null,
      clOrdId: 'stop-limit-cli-1',
    },
  };

  return {
    ...base,
    ...overrides,
    options: { ...base.options, ...overrides.options },
  };
}

function createHub() {
  const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
  const core = hub.Core as BitMex;
  return { hub, core };
}

describe('BitMEX trading – stop-limit flag', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('submits stop-limit payload with both trigger and limit prices', async () => {
    const mockFetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          orderID: 'stop-limit-ord-1',
          clOrdID: 'stop-limit-cli-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 25,
          ordType: 'StopLimit',
          ordStatus: 'New',
          execType: 'New',
          price: 50_150,
          stopPx: 50_200,
          leavesQty: 25,
          cumQty: 0,
          avgPx: 0,
          timestamp: '2024-01-01T00:00:05.000Z',
        }),
        { status: 200 },
      ),
    );

    global.fetch = mockFetch as unknown as typeof fetch;

    const { hub, core } = createHub();
    const prepared = createPreparedStopLimitOrder();

    const order = await core.buy(prepared);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      symbol: 'XBTUSD',
      side: 'Buy',
      ordType: 'StopLimit',
      price: 50_150,
      stopPx: 50_200,
      clOrdID: 'stop-limit-cli-1',
    });

    const snapshot = order.getSnapshot();
    expect(snapshot.type).toBe('StopLimit');
    expect(snapshot.price).toBe(50_150);
    expect(snapshot.stopPrice).toBe(50_200);
    expect(snapshot.status).toBe(OrderStatus.Placed);

    expect(hub.orders.getByClOrdId('stop-limit-cli-1')).toBe(order);
    expect(hub.orders.getInflightByClOrdId('stop-limit-cli-1')).toBeUndefined();
  });
});
