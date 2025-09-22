import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub';
import { OrderStatus } from '../../../src/domain/order';
import { getHistogramValues, resetMetrics } from '../../../src/infra/metrics';
import type { BitMex } from '../../../src/core/bitmex/index';
import type { PreparedPlaceInput } from '../../../src/infra/validation';

const ORIGINAL_FETCH = global.fetch;

function createPreparedMarket(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'buy',
        size: 10,
        type: 'Market',
        price: null,
        stopPrice: null,
        options: {
            postOnly: false,
            reduceOnly: false,
            timeInForce: null,
            clOrdId: 'idempotent-cli-1',
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

describe('BitMEX trading – idempotency', () => {
    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        jest.restoreAllMocks();
    });

    test('reuses inflight promise and cached order for duplicate clOrdID', async () => {
        resetMetrics();

        const mockFetch = jest.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        orderID: 'ord-idem-1',
                        clOrdID: 'idempotent-cli-1',
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

        global.fetch = mockFetch as unknown as typeof fetch;

        const { hub, core } = createHub();
        const prepared = createPreparedMarket();

        const firstPromise = core.buy(prepared);
        const secondPromise = core.buy(prepared);

        expect(secondPromise).toBe(firstPromise);

        const order = await firstPromise;

        expect(order.getSnapshot()).toMatchObject({
            orderId: 'ord-idem-1',
            clOrdId: 'idempotent-cli-1',
            status: OrderStatus.Placed,
        });

        const latencies = getHistogramValues('create_order_latency_ms', {
            exchange: 'BitMEX',
            symbol: 'XBTUSD',
        });

        expect(latencies).toHaveLength(1);
        expect(latencies[0]).toBeGreaterThanOrEqual(0);

        const repeated = await core.buy(prepared);

        expect(repeated).toBe(order);

        expect(hub.orders.getByClOrdId('idempotent-cli-1')).toBe(order);
        expect(hub.orders.getInflightByClOrdId('idempotent-cli-1')).toBeUndefined();

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
