import { METRICS } from '../../../src/infra/metrics-private.js';
import { getHistogramValues } from '../../../src/infra/metrics.js';

import {
  expectChangedKeys,
  expectHistogramIncludes,
  expectCounter,
} from '../../helpers/asserts.js';
import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

describe('BitMEX private integration – auth → partial → updates', () => {
  test('applies snapshots and updates across wallet, position, and order channels', async () => {
    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('wallet', [
        {
          account: 12345,
          currency: 'XBt',
          amount: 1_000_000,
          timestamp: '2024-01-01T00:00:30.000Z',
        },
      ])
      .sendPartial('position', [
        {
          account: 12345,
          symbol: 'XBTUSD',
          currentQty: 50,
          timestamp: '2024-01-01T00:00:32.000Z',
        },
      ])
      .sendPartial('order', [
        {
          orderID: 'ord-1',
          clOrdID: 'cli-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 100,
          price: 50_000,
          leavesQty: 100,
          cumQty: 0,
          avgPx: 0,
          ordStatus: 'New',
          execType: 'New',
          timestamp: '2024-01-01T00:00:34.000Z',
        },
      ])
      .delay(1_000)
      .sendUpdate('wallet', [
        {
          account: 12345,
          currency: 'XBt',
          amount: 1_100_000,
          pendingCredit: 50,
          timestamp: '2024-01-01T00:00:50.000Z',
        },
      ])
      .sendUpdate('position', [
        {
          account: 12345,
          symbol: 'XBTUSD',
          currentQty: 60,
          timestamp: '2024-01-01T00:00:52.000Z',
        },
      ])
      .sendUpdate('order', [
        {
          orderID: 'ord-1',
          symbol: 'XBTUSD',
          leavesQty: 40,
          cumQty: 60,
          avgPx: 50_010,
          execID: 'exec-1',
          execType: 'Trade',
          ordStatus: 'PartiallyFilled',
          lastQty: 60,
          lastPx: 50_010,
          transactTime: '2024-01-01T00:00:54.000Z',
        },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:01:00.000Z' });
    const { clock, hub, server } = harness;

    await clock.waitFor(() => hub.wallets.size > 0);
    const wallet = hub.wallets.get('12345');
    expect(wallet).toBeDefined();

    const walletEvents: any[] = [];
    wallet!.on('update', (_snapshot, diff) => {
      walletEvents.push(diff);
    });

    await clock.waitFor(() => hub.positions.toArray().length > 0);
    const position = hub.positions.get('12345', 'XBTUSD');
    expect(position).toBeDefined();

    const positionEvents: any[] = [];
    position!.on('update', (_snapshot, diff) => {
      positionEvents.push(diff);
    });

    const orderEvents: any[] = [];
    await clock.waitFor(() => hub.orders.size > 0);
    const order = hub.orders.getByOrderId('ord-1');
    expect(order).toBeDefined();
    order!.on('update', (_snapshot, diff) => {
      orderEvents.push(diff);
    });

    await server.waitForCompletion();
    await clock.wait(10);

    expect(walletEvents).toHaveLength(1);
    expectChangedKeys(walletEvents[0], ['balances', 'updatedAt']);

    expect(positionEvents).toHaveLength(1);
    expectChangedKeys(positionEvents[0], ['currentQty', 'size', 'timestamp']);

    expect(orderEvents.length).toBeGreaterThanOrEqual(1);
    expectChangedKeys(orderEvents[orderEvents.length - 1], [
      'leavesQty',
      'filledQty',
      'avgFillPrice',
      'status',
      'executions',
      'lastUpdateTs',
    ]);

    expectCounter(METRICS.walletUpdateCount, 2, { env: 'testnet', table: 'wallet' });
    expectCounter(METRICS.positionUpdateCount, 2, {
      env: 'testnet',
      table: 'position',
      symbol: 'XBTUSD',
    });
    expectCounter(METRICS.orderUpdateCount, 2, {
      env: 'testnet',
      table: 'order',
      symbol: 'XBTUSD',
    });

    expectHistogramIncludes(
      METRICS.privateLatencyMs,
      11_000,
      { env: 'testnet', table: 'wallet' },
      100,
    );
    expectHistogramIncludes(
      METRICS.privateLatencyMs,
      9_000,
      {
        env: 'testnet',
        table: 'position',
        symbol: 'XBTUSD',
      },
      100,
    );
    expectHistogramIncludes(
      METRICS.privateLatencyMs,
      7_000,
      {
        env: 'testnet',
        table: 'order',
        symbol: 'XBTUSD',
      },
      150,
    );

    expect(
      getHistogramValues(METRICS.privateLatencyMs, { env: 'testnet', table: 'wallet' }).length,
    ).toBeGreaterThanOrEqual(2);

    await harness.cleanup();
  });
});
