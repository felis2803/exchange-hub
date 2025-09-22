import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub';
import { OrderStatus } from '../../../src/domain/order';
import type { BitMex } from '../../../src/core/bitmex/index';
import type { PreparedPlaceInput } from '../../../src/infra/validation';

const ORIGINAL_FETCH = global.fetch;

function createPreparedLimit(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'buy',
        size: 15,
        type: 'Limit',
        price: 50_000,
        stopPrice: null,
        options: {
            postOnly: false,
            reduceOnly: false,
            timeInForce: null,
            clOrdId: 'race-cli-1',
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

describe('BitMEX trading – race between WS and REST', () => {
    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        jest.restoreAllMocks();
    });

    test('returns existing order when private update arrives first', async () => {
        const { hub, core } = createHub();
        const prepared = createPreparedLimit();

        const mockFetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const method = init?.method ?? 'GET';

            if (method !== 'POST') {
                throw new Error(`Unexpected method ${method}`);
            }

            return new Promise<Response>(resolve => {
                setTimeout(() => {
                    const order = hub.orders.create('ord-race-1', {
                        clOrdId: 'race-cli-1',
                        symbol: 'XBTUSD',
                        status: OrderStatus.Placed,
                        side: 'buy',
                        type: 'Limit',
                        price: 50_000,
                        qty: 15,
                        leavesQty: 15,
                        submittedAt: Date.parse('2024-01-01T00:00:05.000Z'),
                    });

                    expect(order.getSnapshot().orderId).toBe('ord-race-1');

                    resolve(
                        new Response(
                            JSON.stringify({
                                orderID: 'ord-race-1',
                                clOrdID: 'race-cli-1',
                                symbol: 'XBTUSD',
                                side: 'Buy',
                                orderQty: 15,
                                ordType: 'Limit',
                                ordStatus: 'New',
                                execType: 'New',
                                price: 50_000,
                                leavesQty: 15,
                                cumQty: 0,
                                avgPx: 0,
                                timestamp: '2024-01-01T00:00:06.000Z',
                            }),
                            { status: 200 },
                        ),
                    );
                }, 0);
            });
        });

        global.fetch = mockFetch as unknown as typeof fetch;

        const order = await core.buy(prepared);

        const snapshot = order.getSnapshot();

        expect(snapshot.orderId).toBe('ord-race-1');
        expect(snapshot.clOrdId).toBe('race-cli-1');
        expect(snapshot.status).toBe(OrderStatus.Placed);

        expect(hub.orders.getByClOrdId('race-cli-1')).toBe(order);
        expect(hub.orders.getInflightByClOrdId('race-cli-1')).toBeUndefined();

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
