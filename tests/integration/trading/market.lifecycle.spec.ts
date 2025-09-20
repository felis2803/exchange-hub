import { jest } from '@jest/globals';

import { OrderStatus } from '../../../src/domain/order.js';

import type { PreparedPlaceInput } from '../../../src/infra/validation.js';

import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

const ORIGINAL_FETCH = global.fetch;

function createPreparedMarket(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
  const base: PreparedPlaceInput = {
    symbol: 'XBTUSD',
    side: 'buy',
    size: 10,
    type: 'Market',
    price: null,
    stopPrice: null,
    options: {
      postOnly: false,
      reduceOnly: false,
      timeInForce: null,
      clOrdId: 'market-cli-1',
    },
  };

  return {
    ...base,
    ...overrides,
    options: { ...base.options, ...overrides.options },
  };
}

describe('BitMEX trading – market lifecycle', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('tracks market order fills emitted by the private stream', async () => {
    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('order', [])
      .delay(20)
      .sendInsert('order', [
        {
          orderID: 'market-ord-1',
          clOrdID: 'market-cli-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 10,
          ordType: 'Market',
          ordStatus: 'New',
          execType: 'New',
          leavesQty: 10,
          cumQty: 0,
          avgPx: 0,
          timestamp: '2024-01-01T00:00:01.000Z',
        },
      ])
      .delay(50)
      .sendUpdate('order', [
        {
          orderID: 'market-ord-1',
          clOrdID: 'market-cli-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 10,
          ordStatus: 'Filled',
          execType: 'Trade',
          leavesQty: 0,
          cumQty: 10,
          avgPx: 50_100,
          lastQty: 10,
          lastPx: 50_100,
          transactTime: '2024-01-01T00:00:02.000Z',
        },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, {
      startTime: '2024-01-01T00:00:00.000Z',
    });
    const { clock, hub, core, server } = harness;

    const mockFetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  orderID: 'market-ord-1',
                  clOrdID: 'market-cli-1',
                  symbol: 'XBTUSD',
                  side: 'Buy',
                  orderQty: 10,
                  ordType: 'Market',
                  ordStatus: 'Filled',
                  execType: 'Trade',
                  leavesQty: 0,
                  cumQty: 10,
                  avgPx: 50_100,
                  timestamp: '2024-01-01T00:00:02.500Z',
                }),
                { status: 200 },
              ),
            );
          }, 150);
        }),
    );

    global.fetch = mockFetch as unknown as typeof fetch;

    const prepared = createPreparedMarket();
    const orderPromise = core.buy(prepared);

    expect(hub.orders.getInflightByClOrdId('market-cli-1')).toBeDefined();

    await clock.waitFor(() => hub.orders.getByClOrdId('market-cli-1') !== undefined);

    const interim = hub.orders.getByClOrdId('market-cli-1');
    expect(interim).toBeDefined();
    expect(interim!.getSnapshot().status).toBe(OrderStatus.Placed);

    await clock.waitFor(
      () => hub.orders.getByClOrdId('market-cli-1')?.getSnapshot().status === OrderStatus.Filled,
    );

    await clock.wait(200);
    const order = await orderPromise;
    expect(order).toBe(interim);

    const snapshot = order.getSnapshot();
    expect(snapshot.status).toBe(OrderStatus.Filled);
    expect(snapshot.filledQty).toBe(10);
    expect(snapshot.avgFillPrice).toBeCloseTo(50_100, 6);
    expect(snapshot.type).toBe('Market');

    expect(hub.orders.getInflightByClOrdId('market-cli-1')).toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 10,
      ordType: 'Market',
      clOrdID: 'market-cli-1',
    });

    await server.waitForCompletion();
    await clock.wait(10);
    await harness.cleanup();
  });
});
