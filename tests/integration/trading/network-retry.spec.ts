import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { OrderStatus } from '../../../src/domain/order.js';
import { getHistogramValues, resetMetrics } from '../../../src/infra/metrics.js';

import type { BitMex } from '../../../src/core/bitmex/index.js';
import type { PreparedPlaceInput } from '../../../src/infra/validation.js';

const ORIGINAL_FETCH = global.fetch;

function createPreparedMarket(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
  const base: PreparedPlaceInput = {
    symbol: 'XBTUSD',
    side: 'buy',
    size: 5,
    type: 'Market',
    price: null,
    stopPrice: null,
    options: {
      postOnly: false,
      reduceOnly: false,
      timeInForce: null,
      clOrdId: 'retry-cli-1',
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

describe('BitMEX trading – network retry', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('retries once on recoverable errors', async () => {
    resetMetrics();

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('Service unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            orderID: 'ord-retry-1',
            clOrdID: 'retry-cli-1',
            symbol: 'XBTUSD',
            side: 'Buy',
            orderQty: 5,
            ordType: 'Market',
            ordStatus: 'New',
            execType: 'New',
            leavesQty: 5,
            cumQty: 0,
            avgPx: 0,
            timestamp: '2024-01-01T00:00:04.000Z',
          }),
          { status: 200 },
        ),
      );

    global.fetch = mockFetch as unknown as typeof fetch;

    const { hub, core } = createHub();
    const prepared = createPreparedMarket();

    const order = await core.buy(prepared);

    expect(order.getSnapshot()).toMatchObject({
      orderId: 'ord-retry-1',
      clOrdId: 'retry-cli-1',
      status: OrderStatus.Placed,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.method ?? 'GET').toBe('POST');
    expect((mockFetch.mock.calls[1]?.[1] as RequestInit | undefined)?.method ?? 'GET').toBe('POST');

    expect(hub.orders.getByClOrdId('retry-cli-1')).toBe(order);
    expect(hub.orders.getInflightByClOrdId('retry-cli-1')).toBeUndefined();

    const latencies = getHistogramValues('create_order_latency_ms', {
      exchange: 'BitMEX',
      symbol: 'XBTUSD',
    });
    expect(latencies).toHaveLength(1);
    expect(latencies[0]).toBeGreaterThanOrEqual(0);
  });
});
