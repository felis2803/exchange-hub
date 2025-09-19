import { METRICS } from '../../../src/infra/metrics-private.js';

import { expectCounter } from '../../helpers/asserts.js';
import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

describe('BitMEX private integration – reconnect and resubscribe', () => {
  test('rebuilds snapshots from fresh partials after reconnect', async () => {
    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('wallet', [
        { account: 777, currency: 'XBt', amount: 200_000, timestamp: '2024-01-01T00:02:10.000Z' },
      ])
      .sendPartial('position', [
        { account: 777, symbol: 'XBTUSD', currentQty: 5, timestamp: '2024-01-01T00:02:11.000Z' },
      ])
      .sendPartial('order', [
        {
          orderID: 'recon-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 30,
          leavesQty: 30,
          cumQty: 0,
          ordStatus: 'New',
          execType: 'New',
          timestamp: '2024-01-01T00:02:12.000Z',
        },
      ])
      .sendUpdate('wallet', [
        { account: 777, currency: 'XBt', amount: 210_000, timestamp: '2024-01-01T00:02:20.000Z' },
      ])
      .delay(500)
      .drop()
      .acceptReconnect()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('wallet', [
        { account: 777, currency: 'XBt', amount: 900_000, timestamp: '2024-01-01T00:03:10.000Z' },
      ])
      .sendPartial('position', [
        { account: 777, symbol: 'XBTUSD', currentQty: 70, timestamp: '2024-01-01T00:03:11.000Z' },
      ])
      .sendPartial('order', [
        {
          orderID: 'recon-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 30,
          leavesQty: 5,
          cumQty: 25,
          ordStatus: 'PartiallyFilled',
          execType: 'Trade',
          timestamp: '2024-01-01T00:03:12.000Z',
        },
      ])
      .sendUpdate('order', [
        {
          orderID: 'recon-1',
          symbol: 'XBTUSD',
          leavesQty: 0,
          cumQty: 30,
          avgPx: 50_200,
          execID: 'recon-fill',
          execType: 'Trade',
          ordStatus: 'Filled',
          lastQty: 5,
          lastPx: 50_200,
          transactTime: '2024-01-01T00:03:20.000Z',
        },
      ])
      .sendUpdate('wallet', [
        { account: 777, currency: 'XBt', amount: 905_000, timestamp: '2024-01-01T00:03:21.000Z' },
      ])
      .sendUpdate('position', [
        { account: 777, symbol: 'XBTUSD', currentQty: 75, timestamp: '2024-01-01T00:03:22.000Z' },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:04:00.000Z' });
    const { clock, hub, server } = harness;

    await clock.waitFor(() => hub.wallets.size > 0);
    const wallet = hub.wallets.get('777');
    expect(wallet).toBeDefined();

    await clock.waitFor(() => hub.positions.toArray().length > 0);
    const position = hub.positions.get('777', 'XBTUSD');
    expect(position).toBeDefined();

    await clock.waitFor(() => hub.orders.size > 0);
    const order = hub.orders.getByOrderId('recon-1');
    expect(order).toBeDefined();

    await server.waitForCompletion();
    await clock.wait(10);

    expect(wallet!.getSnapshot().balances.xbt.amount).toBe(905_000);
    expect(position!.getSnapshot().currentQty).toBe(75);
    expect(order!.getSnapshot().status).toBe('filled');
    expect(order.getSnapshot().filledQty).toBe(30);

    expectCounter(METRICS.walletUpdateCount, 4, { env: 'testnet', table: 'wallet' });
    expectCounter(METRICS.positionUpdateCount, 3, { env: 'testnet', table: 'position', symbol: 'XBTUSD' });
    expectCounter(METRICS.orderUpdateCount, 3, { env: 'testnet', table: 'order', symbol: 'XBTUSD' });

    await harness.cleanup();
  });
});
