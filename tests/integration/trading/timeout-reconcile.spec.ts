import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub';
import { OrderStatus } from '../../../src/domain/order';
import { getCounterValue, resetMetrics } from '../../../src/infra/metrics';
import type { BitMex } from '../../../src/core/bitmex/index';
import type { PreparedPlaceInput } from '../../../src/infra/validation';
import type { FetchRequestInit, FetchRequestInfo } from '../../fetch-types';

const ORIGINAL_FETCH = global.fetch;

function createPreparedMarket(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'buy',
        size: 20,
        type: 'Market',
        price: null,
        stopPrice: null,
        options: {
            postOnly: false,
            reduceOnly: false,
            timeInForce: null,
            clOrdId: 'timeout-cli-1',
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

describe('BitMEX trading – timeout reconcile', () => {
    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        jest.restoreAllMocks();
    });

    test('falls back to GET reconcile after timeout', async () => {
        resetMetrics();

        const abortError = new Error('Aborted');

        abortError.name = 'AbortError';

        const mockFetch = jest.fn((input: FetchRequestInfo | URL, init?: FetchRequestInit) => {
            const method = init?.method ?? 'GET';

            if (method === 'POST') {
                return Promise.reject(abortError);
            }

            if (method === 'GET') {
                const url = new URL(String(input));

                expect(url.pathname).toBe('/api/v1/order');
                expect(url.searchParams.get('clOrdID')).toBe('timeout-cli-1');

                return Promise.resolve(
                    new Response(
                        JSON.stringify([
                            {
                                orderID: 'ord-timeout-1',
                                clOrdID: 'timeout-cli-1',
                                symbol: 'XBTUSD',
                                side: 'Buy',
                                orderQty: 20,
                                ordType: 'Market',
                                ordStatus: 'New',
                                execType: 'New',
                                leavesQty: 20,
                                cumQty: 0,
                                avgPx: 0,
                                timestamp: '2024-01-01T00:00:03.000Z',
                            },
                        ]),
                        { status: 200 },
                    ),
                );
            }

            throw new Error(`Unexpected method ${method}`);
        });

        global.fetch = mockFetch as unknown as typeof fetch;

        const { hub, core } = createHub();
        const prepared = createPreparedMarket();

        const order = await core.buy(prepared);

        expect(order.getSnapshot()).toMatchObject({
            orderId: 'ord-timeout-1',
            clOrdId: 'timeout-cli-1',
            status: OrderStatus.Placed,
        });

        expect(hub.orders.getByClOrdId('timeout-cli-1')).toBe(order);
        expect(hub.orders.getInflightByClOrdId('timeout-cli-1')).toBeUndefined();

        expect(mockFetch).toHaveBeenCalledTimes(2);

        const [[postUrl, postInit], [getUrl, getInit]] = mockFetch.mock.calls as [
            [FetchRequestInfo | URL, FetchRequestInit | undefined],
            [FetchRequestInfo | URL, FetchRequestInit | undefined],
        ];

        expect(postInit?.method ?? 'GET').toBe('POST');
        expect(new URL(String(postUrl)).pathname).toBe('/api/v1/order');
        expect(getInit?.method ?? 'GET').toBe('GET');
        expect(new URL(String(getUrl)).searchParams.get('clOrdID')).toBe('timeout-cli-1');

        const errorCount = getCounterValue('create_order_errors_total', {
            exchange: 'BitMEX',
            symbol: 'XBTUSD',
            error: 'TimeoutError',
            code: 'TIMEOUT',
        });

        expect(errorCount).toBe(1);
    });
});
