import { METRICS } from '../../../src/infra/metrics-private.js';
import { getHistogramValues } from '../../../src/infra/metrics.js';

import { expectCounter, expectHistogramValues } from '../../helpers/asserts.js';
import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

describe('BitMEX private integration – metrics latency', () => {
  test('records latency histograms and update counters with proper labels', async () => {
    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('wallet', [
        { account: 404, currency: 'XBt', amount: 1_500_000, timestamp: '2024-01-01T00:08:00.000Z' },
      ])
      .sendPartial('position', [
        { account: 404, symbol: 'XBTUSD', currentQty: 15, timestamp: '2024-01-01T00:08:01.000Z' },
      ])
      .sendPartial('order', [
        {
          orderID: 'metric-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 40,
          leavesQty: 40,
          cumQty: 0,
          ordStatus: 'New',
          execType: 'New',
          timestamp: '2024-01-01T00:08:02.000Z',
        },
      ])
      .delay(400)
      .sendUpdate('wallet', [
        { account: 404, currency: 'XBt', amount: 1_550_000, timestamp: '2024-01-01T00:08:10.000Z' },
      ])
      .sendUpdate('position', [
        { account: 404, symbol: 'XBTUSD', currentQty: 25, timestamp: '2024-01-01T00:08:11.000Z' },
      ])
      .sendUpdate('order', [
        {
          orderID: 'metric-1',
          symbol: 'XBTUSD',
          leavesQty: 10,
          cumQty: 30,
          avgPx: 49_500,
          execID: 'metric-fill',
          execType: 'Trade',
          ordStatus: 'PartiallyFilled',
          lastQty: 30,
          lastPx: 49_500,
          transactTime: '2024-01-01T00:08:12.000Z',
        },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:09:00.000Z' });
    const { clock, server } = harness;

    await server.waitForCompletion();
    await clock.wait(10);

    const walletLatencies = getHistogramValues(METRICS.privateLatencyMs, {
      env: 'testnet',
      table: 'wallet',
    });
    const positionLatencies = getHistogramValues(METRICS.privateLatencyMs, {
      env: 'testnet',
      table: 'position',
      symbol: 'XBTUSD',
    });
    const orderLatencies = getHistogramValues(METRICS.privateLatencyMs, {
      env: 'testnet',
      table: 'order',
      symbol: 'XBTUSD',
    });

    expect(walletLatencies).toHaveLength(2);
    expect(positionLatencies).toHaveLength(2);
    expect(orderLatencies).toHaveLength(2);

    expectCounter(METRICS.walletUpdateCount, 2, { env: 'testnet', table: 'wallet' });
    expectCounter(METRICS.positionUpdateCount, 2, { env: 'testnet', table: 'position', symbol: 'XBTUSD' });
    expectCounter(METRICS.orderUpdateCount, 2, { env: 'testnet', table: 'order', symbol: 'XBTUSD' });

    expectHistogramValues(METRICS.privateLatencyMs, walletLatencies, {
      env: 'testnet',
      table: 'wallet',
    });

    await harness.cleanup();
  });
});
