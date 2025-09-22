import { jest } from '@jest/globals';

import { ExchangeHub } from '../../../src/ExchangeHub';
import { OrderStatus } from '../../../src/domain/order';
import type { BitMex } from '../../../src/core/bitmex/index';
import type { PreparedPlaceInput } from '../../../src/infra/validation';

const ORIGINAL_FETCH = global.fetch;

function createHub() {
    const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
    const core = hub.Core as BitMex;

    return { hub, core };
}

describe('BitMEX REST createOrder – limit/postOnly', () => {
    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        jest.restoreAllMocks();
    });

    test('submits limit payload with price and timeInForce', async () => {
        const mockFetch = jest.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        orderID: 'ord-10',
                        clOrdID: 'cli-10',
                        symbol: 'XBTUSD',
                        side: 'Sell',
                        orderQty: 5,
                        price: 61_000,
                        ordType: 'Limit',
                        ordStatus: 'New',
                        execType: 'New',
                        leavesQty: 5,
                        cumQty: 0,
                        avgPx: 0,
                        timestamp: '2024-01-01T00:00:00.000Z',
                    }),
                    { status: 200 },
                ),
        );

        global.fetch = mockFetch as unknown as typeof fetch;

        const { hub, core } = createHub();
        const prepared: PreparedPlaceInput = {
            symbol: 'XBTUSD',
            side: 'sell',
            size: 5,
            type: 'Limit',
            price: 61_000,
            stopPrice: null,
            options: {
                postOnly: false,
                reduceOnly: false,
                timeInForce: 'GoodTillCancel',
                clOrdId: 'cli-10',
            },
        };

        const order = await core.sell(prepared);

        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
        const body = JSON.parse(String(init.body));

        expect(body).toMatchObject({
            symbol: 'XBTUSD',
            side: 'Sell',
            orderQty: 5,
            price: 61_000,
            ordType: 'Limit',
            clOrdID: 'cli-10',
            timeInForce: 'GoodTillCancel',
        });

        const snapshot = order.getSnapshot();

        expect(snapshot.status).toBe(OrderStatus.Placed);
        expect(snapshot.price).toBe(61_000);
        expect(hub.orders.getByClOrdId('cli-10')).toBe(order);
    });

    test('maps postOnly and reduceOnly to execInst', async () => {
        const mockFetch = jest.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        orderID: 'ord-11',
                        clOrdID: 'cli-11',
                        symbol: 'XBTUSD',
                        side: 'Buy',
                        orderQty: 3,
                        price: 60_500,
                        ordType: 'Limit',
                        ordStatus: 'New',
                        execType: 'New',
                        leavesQty: 3,
                        cumQty: 0,
                        avgPx: 0,
                        timestamp: '2024-01-01T00:00:00.000Z',
                    }),
                    { status: 200 },
                ),
        );

        global.fetch = mockFetch as unknown as typeof fetch;

        const { core } = createHub();
        const prepared: PreparedPlaceInput = {
            symbol: 'XBTUSD',
            side: 'buy',
            size: 3,
            type: 'Limit',
            price: 60_500,
            stopPrice: null,
            options: {
                postOnly: true,
                reduceOnly: true,
                timeInForce: null,
                clOrdId: 'cli-11',
            },
        };

        await core.buy(prepared);

        const [, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
        const body = JSON.parse(String(init.body));

        expect(body.execInst).toBe('ParticipateDoNotInitiate,ReduceOnly');
    });
});
