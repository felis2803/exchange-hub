import { METRICS } from '../../../src/infra/metrics-private.js';

import { expectChangedKeys, expectCounter } from '../../helpers/asserts.js';
import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

describe('BitMEX private integration – out-of-order and duplicate handling', () => {
  test('ignores stale wallet/position updates and duplicate order executions', async () => {
    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('wallet', [
        {
          account: 999,
          currency: 'XBt',
          amount: 500_000,
          timestamp: '2024-01-01T00:01:20.000Z',
        },
      ])
      .sendPartial('position', [
        {
          account: 999,
          symbol: 'XBTUSD',
          currentQty: 25,
          timestamp: '2024-01-01T00:01:21.000Z',
        },
      ])
      .sendPartial('order', [
        {
          orderID: 'dup-1',
          clOrdID: 'dup-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 80,
          leavesQty: 80,
          cumQty: 0,
          ordStatus: 'New',
          execType: 'New',
          timestamp: '2024-01-01T00:01:22.000Z',
        },
      ])
      .delay(500)
      .sendUpdate('wallet', [
        {
          account: 999,
          currency: 'XBt',
          amount: 510_000,
          timestamp: '2024-01-01T00:01:40.000Z',
        },
      ])
      .sendUpdate('wallet', [
        {
          account: 999,
          currency: 'XBt',
          amount: 480_000,
          timestamp: '2024-01-01T00:01:35.000Z',
        },
      ])
      .sendUpdate('position', [
        {
          account: 999,
          symbol: 'XBTUSD',
          currentQty: 40,
          timestamp: '2024-01-01T00:01:41.000Z',
        },
      ])
      .sendUpdate('position', [
        {
          account: 999,
          symbol: 'XBTUSD',
          currentQty: 10,
          timestamp: '2024-01-01T00:01:39.000Z',
        },
      ])
      .sendUpdate('order', [
        {
          orderID: 'dup-1',
          symbol: 'XBTUSD',
          leavesQty: 20,
          cumQty: 60,
          avgPx: 50_500,
          execID: 'exec-dup',
          execType: 'Trade',
          ordStatus: 'PartiallyFilled',
          lastQty: 60,
          lastPx: 50_500,
          transactTime: '2024-01-01T00:01:42.000Z',
        },
      ])
      .sendUpdate('order', [
        {
          orderID: 'dup-1',
          symbol: 'XBTUSD',
          leavesQty: 20,
          cumQty: 60,
          avgPx: 50_500,
          execID: 'exec-dup',
          execType: 'Trade',
          ordStatus: 'PartiallyFilled',
          lastQty: 60,
          lastPx: 50_500,
          transactTime: '2024-01-01T00:01:43.000Z',
        },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:02:00.000Z' });
    const { clock, hub, server } = harness;

    await clock.waitFor(() => hub.wallets.size > 0);
    const wallet = hub.wallets.get('999');
    expect(wallet).toBeDefined();
    const walletEvents: any[] = [];
    wallet!.on('update', (_snapshot, diff) => walletEvents.push(diff));

    await clock.waitFor(() => hub.positions.toArray().length > 0);
    const position = hub.positions.get('999', 'XBTUSD');
    expect(position).toBeDefined();
    const positionEvents: any[] = [];
    position!.on('update', (_snapshot, diff) => positionEvents.push(diff));

    await clock.waitFor(() => hub.orders.size > 0);
    const order = hub.orders.getByOrderId('dup-1');
    expect(order).toBeDefined();
    const orderEvents: any[] = [];
    order!.on('update', (_snapshot, diff) => orderEvents.push(diff));

    await server.waitForCompletion();
    await clock.wait(10);

    expect(walletEvents).toHaveLength(1);
    expectChangedKeys(walletEvents[0], ['balances', 'updatedAt']);
    expect(wallet!.getSnapshot().balances.xbt.amount).toBe(510_000);

    expect(positionEvents).toHaveLength(1);
    expectChangedKeys(positionEvents[0], ['currentQty', 'size', 'timestamp']);
    expect(position!.getSnapshot().currentQty).toBe(40);

    expect(orderEvents).toHaveLength(2);
    expectChangedKeys(orderEvents[0], [
      'leavesQty',
      'filledQty',
      'avgFillPrice',
      'status',
      'executions',
      'lastUpdateTs',
    ]);
    expectChangedKeys(orderEvents[1], ['lastUpdateTs']);
    expect(order!.getSnapshot().filledQty).toBe(60);

    expectCounter(METRICS.walletUpdateCount, 2, { env: 'testnet', table: 'wallet' });
    expectCounter(METRICS.positionUpdateCount, 2, {
      env: 'testnet',
      table: 'position',
      symbol: 'XBTUSD',
    });
    expectCounter(METRICS.orderUpdateCount, 3, {
      env: 'testnet',
      table: 'order',
      symbol: 'XBTUSD',
    });

    await harness.cleanup();
  });
});
