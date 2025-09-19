import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';
import { expectChangedKeys } from '../../helpers/asserts.js';

describe('BitMEX private integration – cross-channel consistency', () => {
  test('aligned wallet and position updates accompany order fills without redundant diffs', async () => {
    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('wallet', [
        { account: 555, currency: 'XBt', amount: 800_000, timestamp: '2024-01-01T00:06:10.000Z' },
      ])
      .sendPartial('position', [
        { account: 555, symbol: 'XBTUSD', currentQty: 20, timestamp: '2024-01-01T00:06:11.000Z' },
      ])
      .sendPartial('order', [
        {
          orderID: 'sync-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 60,
          leavesQty: 60,
          cumQty: 0,
          ordStatus: 'New',
          execType: 'New',
          timestamp: '2024-01-01T00:06:12.000Z',
        },
      ])
      .delay(300)
      .sendUpdate('order', [
        {
          orderID: 'sync-1',
          symbol: 'XBTUSD',
          leavesQty: 0,
          cumQty: 60,
          avgPx: 49_900,
          execID: 'sync-fill',
          execType: 'Trade',
          ordStatus: 'Filled',
          lastQty: 60,
          lastPx: 49_900,
          transactTime: '2024-01-01T00:06:20.000Z',
        },
      ])
      .sendUpdate('position', [
        { account: 555, symbol: 'XBTUSD', currentQty: 80, timestamp: '2024-01-01T00:06:21.000Z' },
      ])
      .sendUpdate('wallet', [
        { account: 555, currency: 'XBt', amount: 805_000, timestamp: '2024-01-01T00:06:22.000Z' },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:07:00.000Z' });
    const { clock, hub, server } = harness;

    await clock.waitFor(() => hub.wallets.size > 0);
    const wallet = hub.wallets.get('555');
    expect(wallet).toBeDefined();
    const walletDiffs: any[] = [];
    wallet!.on('update', (_snapshot, diff) => walletDiffs.push(diff));

    await clock.waitFor(() => hub.positions.toArray().length > 0);
    const position = hub.positions.get('555', 'XBTUSD');
    expect(position).toBeDefined();
    const positionDiffs: any[] = [];
    position!.on('update', (_snapshot, diff) => positionDiffs.push(diff));

    await clock.waitFor(() => hub.orders.size > 0);
    const order = hub.orders.getByOrderId('sync-1');
    expect(order).toBeDefined();
    const orderDiffs: any[] = [];
    order!.on('update', (_snapshot, diff) => orderDiffs.push(diff));

    await server.waitForCompletion();
    await clock.wait(10);

    expect(order!.getSnapshot().filledQty).toBe(60);
    expect(position!.getSnapshot().currentQty).toBe(80);
    expect(wallet!.getSnapshot().balances.xbt.amount).toBe(805_000);

    expect(orderDiffs).toHaveLength(1);
    expectChangedKeys(orderDiffs[0], [
      'leavesQty',
      'filledQty',
      'avgFillPrice',
      'status',
      'executions',
      'lastUpdateTs',
    ]);

    expect(positionDiffs).toHaveLength(1);
    expectChangedKeys(positionDiffs[0], ['currentQty', 'size', 'timestamp']);

    expect(walletDiffs).toHaveLength(1);
    expectChangedKeys(walletDiffs[0], ['balances', 'updatedAt']);

    await harness.cleanup();
  });
});
