import { OrderStatus } from '../../../src/domain/order.js';
import { METRICS } from '../../../src/infra/metrics-private.js';
import { expectChangedKeys, expectCounter } from '../../helpers/asserts.js';
import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

describe('BitMEX private integration – order lifecycle', () => {
    test('handles fills, cancel state transitions, and idempotent executions', async () => {
        const scenario = createScenario()
            .open()
            .requireAuth()
            .expectAuth()
            .expectSubscribe(['wallet', 'position', 'order'])
            .sendSubscribeAck(['wallet', 'position', 'order'])
            .sendPartial('order', [
                {
                    orderID: 'life-1',
                    clOrdID: 'life-1',
                    symbol: 'XBTUSD',
                    side: 'Buy',
                    orderQty: 100,
                    leavesQty: 100,
                    cumQty: 0,
                    ordStatus: 'New',
                    execType: 'New',
                    timestamp: '2024-01-01T00:04:00.000Z',
                },
            ])
            .delay(200)
            .sendUpdate('order', [
                {
                    orderID: 'life-1',
                    symbol: 'XBTUSD',
                    leavesQty: 40,
                    cumQty: 60,
                    avgPx: 50_100,
                    execID: 'life-fill-1',
                    execType: 'Trade',
                    ordStatus: 'PartiallyFilled',
                    lastQty: 60,
                    lastPx: 50_100,
                    transactTime: '2024-01-01T00:04:05.000Z',
                },
            ])
            .delay(200)
            .sendUpdate('order', [
                {
                    orderID: 'life-1',
                    symbol: 'XBTUSD',
                    leavesQty: 0,
                    cumQty: 100,
                    avgPx: 50_150,
                    execID: 'life-fill-2',
                    execType: 'Trade',
                    ordStatus: 'Filled',
                    lastQty: 40,
                    lastPx: 50_200,
                    transactTime: '2024-01-01T00:04:07.000Z',
                },
            ])
            .delay(200)
            .sendUpdate('order', [
                {
                    orderID: 'life-1',
                    symbol: 'XBTUSD',
                    leavesQty: 0,
                    cumQty: 100,
                    avgPx: 50_150,
                    execID: 'life-fill-2',
                    execType: 'Trade',
                    ordStatus: 'Filled',
                    lastQty: 40,
                    lastPx: 50_200,
                    transactTime: '2024-01-01T00:04:08.000Z',
                },
            ])
            .build();

        const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:05:00.000Z' });
        const { clock, hub, server } = harness;

        await clock.waitFor(() => hub.orders.size > 0);

        const order = hub.orders.getByOrderId('life-1');

        expect(order).toBeDefined();

        const diffs: any[] = [];

        order!.on('update', (_snapshot, diff) => diffs.push(diff));

        await clock.waitFor(() => diffs.length >= 1);

        const afterFirstFill = order!.getSnapshot();

        expect(afterFirstFill.status).toBe(OrderStatus.PartiallyFilled);

        const cancelDiff = order!.markCanceling('local');

        expect(cancelDiff).not.toBeNull();
        expect(order!.getSnapshot().status).toBe(OrderStatus.Canceling);

        await server.waitForCompletion();
        await clock.wait(10);

        const finalSnapshot = order!.getSnapshot();

        expect(finalSnapshot.status).toBe(OrderStatus.Filled);
        expect(finalSnapshot.filledQty).toBe(100);
        expect(finalSnapshot.avgFillPrice).toBeCloseTo(50_150, 6);
        expect(finalSnapshot.executions).toHaveLength(2);

        expect(diffs.length).toBeGreaterThanOrEqual(3);

        const fillDiff = diffs.find(
            diff => diff && diff.changed.includes('executions') && diff.next.status === OrderStatus.Filled,
        );

        expect(fillDiff).toBeDefined();
        expectChangedKeys(fillDiff!, [
            'leavesQty',
            'filledQty',
            'avgFillPrice',
            'status',
            'executions',
            'lastUpdateTs',
        ]);

        const duplicateDiff = diffs[diffs.length - 1];

        expectChangedKeys(duplicateDiff, ['lastUpdateTs']);

        expectCounter(METRICS.orderUpdateCount, 4, {
            env: 'testnet',
            table: 'order',
            symbol: 'XBTUSD',
        });

        await harness.cleanup();
    });
});
