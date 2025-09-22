import { jest } from '@jest/globals';

import { OrderStatus } from '../../../src/domain/order';
import type { PreparedPlaceInput } from '../../../src/infra/validation';
import { createScenario } from '../../helpers/ws-mock/scenario';
import { setupPrivateHarness } from '../../helpers/privateHarness';

const ORIGINAL_FETCH = global.fetch;

function createPreparedStopOrder(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
    const base: PreparedPlaceInput = {
        symbol: 'XBTUSD',
        side: 'buy',
        size: 75,
        type: 'Stop',
        price: null,
        stopPrice: 50_200,
        options: {
            postOnly: false,
            reduceOnly: false,
            timeInForce: null,
            clOrdId: 'stop-cli-1',
        },
    };

    return {
        ...base,
        ...overrides,
        options: { ...base.options, ...overrides.options },
    };
}

describe('BitMEX trading – stop-market lifecycle', () => {
    afterEach(() => {
        global.fetch = ORIGINAL_FETCH;
        jest.restoreAllMocks();
    });

    test('handles stop order trigger and fill even when WS races REST response', async () => {
        const scenario = createScenario()
            .open()
            .requireAuth()
            .expectAuth()
            .expectSubscribe(['wallet', 'position', 'order'])
            .sendSubscribeAck(['wallet', 'position', 'order'])
            .sendPartial('order', [])
            .delay(50)
            .sendInsert('order', [
                {
                    orderID: 'stop-ord-1',
                    clOrdID: 'stop-cli-1',
                    symbol: 'XBTUSD',
                    side: 'Buy',
                    orderQty: 75,
                    ordType: 'Stop',
                    ordStatus: 'New',
                    execType: 'New',
                    stopPx: 50_200,
                    leavesQty: 75,
                    cumQty: 0,
                    avgPx: 0,
                    timestamp: '2024-01-01T00:00:01.000Z',
                },
            ])
            .delay(50)
            .sendUpdate('order', [
                {
                    orderID: 'stop-ord-1',
                    clOrdID: 'stop-cli-1',
                    symbol: 'XBTUSD',
                    ordStatus: 'Triggered',
                    execType: 'Calculated',
                    stopPx: 50_200,
                    leavesQty: 75,
                    cumQty: 0,
                    timestamp: '2024-01-01T00:00:02.000Z',
                },
            ])
            .delay(50)
            .sendUpdate('order', [
                {
                    orderID: 'stop-ord-1',
                    symbol: 'XBTUSD',
                    side: 'Buy',
                    orderQty: 75,
                    ordStatus: 'Filled',
                    execType: 'Trade',
                    stopPx: 50_200,
                    leavesQty: 0,
                    cumQty: 75,
                    avgPx: 50_250,
                    lastQty: 75,
                    lastPx: 50_250,
                    transactTime: '2024-01-01T00:00:03.000Z',
                },
            ])
            .build();

        const harness = await setupPrivateHarness(scenario, {
            startTime: '2024-01-01T00:00:00.000Z',
        });
        const { clock, hub, core, server } = harness;

        const mockFetch = jest.fn(
            () =>
                new Promise<Response>(resolve => {
                    setTimeout(() => {
                        resolve(
                            new Response(
                                JSON.stringify({
                                    orderID: 'stop-ord-1',
                                    clOrdID: 'stop-cli-1',
                                    symbol: 'XBTUSD',
                                    side: 'Buy',
                                    orderQty: 75,
                                    ordType: 'Stop',
                                    ordStatus: 'New',
                                    execType: 'New',
                                    stopPx: 50_200,
                                    leavesQty: 75,
                                    cumQty: 0,
                                    avgPx: 0,
                                    timestamp: '2024-01-01T00:00:01.500Z',
                                }),
                                { status: 200 },
                            ),
                        );
                    }, 200);
                }),
        );

        global.fetch = mockFetch as unknown as typeof fetch;

        const prepared = createPreparedStopOrder();
        const orderPromise = core.buy(prepared);

        expect(hub.orders.getInflightByClOrdId('stop-cli-1')).toBeDefined();

        await clock.waitFor(() => hub.orders.getByClOrdId('stop-cli-1') !== undefined);

        const interim = hub.orders.getByClOrdId('stop-cli-1');

        expect(interim).toBeDefined();
        expect(interim!.getSnapshot().status).toBe(OrderStatus.Placed);

        await clock.waitFor(() => hub.orders.getByClOrdId('stop-cli-1')?.getSnapshot().status === OrderStatus.Filled);

        await clock.wait(200);

        const order = await orderPromise;

        expect(order).toBe(interim);

        const snapshot = order.getSnapshot();

        expect(snapshot.status).toBe(OrderStatus.Filled);
        expect(snapshot.filledQty).toBe(75);
        expect(snapshot.stopPrice).toBe(50_200);
        expect(snapshot.avgFillPrice).toBeCloseTo(50_250, 6);

        expect(hub.orders.getInflightByClOrdId('stop-cli-1')).toBeUndefined();

        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
        const body = JSON.parse(String(init.body));

        expect(body).toMatchObject({
            ordType: 'Stop',
            stopPx: 50_200,
            clOrdID: 'stop-cli-1',
        });
        expect(body).not.toHaveProperty('price');

        await server.waitForCompletion();
        await clock.wait(10);
        await harness.cleanup();
    });
});
