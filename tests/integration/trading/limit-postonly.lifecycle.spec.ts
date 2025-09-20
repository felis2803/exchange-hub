import { jest } from '@jest/globals';

import { OrderStatus } from '../../../src/domain/order.js';

import type { PreparedPlaceInput } from '../../../src/infra/validation.js';

import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

const ORIGINAL_FETCH = global.fetch;

function createPreparedLimit(overrides: Partial<PreparedPlaceInput> = {}): PreparedPlaceInput {
  const base: PreparedPlaceInput = {
    symbol: 'XBTUSD',
    side: 'buy',
    size: 30,
    type: 'Limit',
    price: 50_050,
    stopPrice: null,
    options: {
      postOnly: true,
      reduceOnly: false,
      timeInForce: 'GoodTillCancel',
      clOrdId: 'limit-cli-1',
    },
  };

  return {
    ...base,
    ...overrides,
    options: { ...base.options, ...overrides.options },
  };
}

describe('BitMEX trading – limit post-only lifecycle', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('places a passive limit order and observes cancellation via WS updates', async () => {
    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('order', [])
      .delay(25)
      .sendInsert('order', [
        {
          orderID: 'limit-ord-1',
          clOrdID: 'limit-cli-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 30,
          ordType: 'Limit',
          ordStatus: 'New',
          execType: 'New',
          price: 50_050,
          leavesQty: 30,
          cumQty: 0,
          avgPx: 0,
          timestamp: '2024-01-01T00:00:01.000Z',
        },
      ])
      .delay(100)
      .sendUpdate('order', [
        {
          orderID: 'limit-ord-1',
          clOrdID: 'limit-cli-1',
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 30,
          ordStatus: 'Canceled',
          execType: 'Canceled',
          leavesQty: 0,
          cumQty: 0,
          avgPx: 0,
          text: 'Canceled: Post-only would cross the book',
          timestamp: '2024-01-01T00:00:03.000Z',
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
                  orderID: 'limit-ord-1',
                  clOrdID: 'limit-cli-1',
                  symbol: 'XBTUSD',
                  side: 'Buy',
                  orderQty: 30,
                  ordType: 'Limit',
                  ordStatus: 'New',
                  execType: 'New',
                  price: 50_050,
                  leavesQty: 30,
                  cumQty: 0,
                  avgPx: 0,
                  execInst: 'ParticipateDoNotInitiate',
                  timestamp: '2024-01-01T00:00:01.500Z',
                }),
                { status: 200 },
              ),
            );
          }, 120);
        }),
    );

    global.fetch = mockFetch as unknown as typeof fetch;

    const prepared = createPreparedLimit();
    const orderPromise = core.buy(prepared);

    expect(hub.orders.getInflightByClOrdId('limit-cli-1')).toBeDefined();

    await clock.waitFor(() => hub.orders.getByClOrdId('limit-cli-1') !== undefined);
    await clock.waitFor(
      () =>
        hub.orders.getByClOrdId('limit-cli-1')?.getSnapshot().execInst ===
        'ParticipateDoNotInitiate',
    );

    const resting = hub.orders.getByClOrdId('limit-cli-1');
    expect(resting).toBeDefined();
    expect(resting!.getSnapshot()).toMatchObject({
      status: OrderStatus.Placed,
      type: 'Limit',
      price: 50_050,
      execInst: 'ParticipateDoNotInitiate',
    });

    await clock.waitFor(
      () => hub.orders.getByClOrdId('limit-cli-1')?.getSnapshot().status === OrderStatus.Canceled,
    );

    await clock.wait(200);
    const order = await orderPromise;
    expect(order).toBe(resting);

    const snapshot = order.getSnapshot();
    expect(snapshot.status).toBe(OrderStatus.Canceled);
    expect(snapshot.execInst).toBe('ParticipateDoNotInitiate');
    expect(snapshot.text).toContain('Post-only');

    expect(hub.orders.getInflightByClOrdId('limit-cli-1')).toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      symbol: 'XBTUSD',
      side: 'Buy',
      orderQty: 30,
      ordType: 'Limit',
      price: 50_050,
      clOrdID: 'limit-cli-1',
      execInst: 'ParticipateDoNotInitiate',
      timeInForce: 'GoodTillCancel',
    });

    await server.waitForCompletion();
    await clock.wait(10);
    await harness.cleanup();
  });
});
