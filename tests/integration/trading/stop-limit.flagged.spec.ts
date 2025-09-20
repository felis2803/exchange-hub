import { jest } from '@jest/globals';

import { Instrument } from '../../../src/domain/instrument.js';
import { OrderStatus } from '../../../src/domain/order.js';
import { ValidationError } from '../../../src/infra/errors.js';

import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

const ORIGINAL_FETCH = global.fetch;

describe('BitMEX trading – stop-limit orders', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('submits stop-limit payload when flag is provided', async () => {
    const clOrdID = 'stop-limit-1';
    const stopPrice = 49_950;
    const limitPrice = 49_940;

    const scenario = createScenario()
      .open()
      .requireAuth()
      .expectAuth()
      .expectSubscribe(['wallet', 'position', 'order'])
      .sendSubscribeAck(['wallet', 'position', 'order'])
      .sendPartial('order', [])
      .delay(40)
      .sendInsert('order', [
        {
          orderID: 'ws-stop-limit-1',
          clOrdID,
          symbol: 'XBTUSD',
          side: 'Sell',
          orderQty: 5,
          ordType: 'StopLimit',
          stopPx: stopPrice,
          price: limitPrice,
          ordStatus: 'New',
          execType: 'New',
          leavesQty: 5,
          cumQty: 0,
          timestamp: '2024-01-01T00:02:00.000Z',
        },
      ])
      .delay(60)
      .sendUpdate('order', [
        {
          orderID: 'ws-stop-limit-1',
          symbol: 'XBTUSD',
          leavesQty: 0,
          cumQty: 5,
          avgPx: 49_930,
          ordStatus: 'Filled',
          execType: 'Trade',
          lastQty: 5,
          lastPx: 49_930,
          stopPx: stopPrice,
          price: limitPrice,
          transactTime: '2024-01-01T00:02:00.120Z',
        },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:02:00.000Z' });
    const { core, clock, server, cleanup } = harness;

    try {
      const fetchMock = jest.fn(
        async () =>
          new Response(
            JSON.stringify({
              orderID: 'ws-stop-limit-1',
              clOrdID,
              symbol: 'XBTUSD',
              side: 'Sell',
              orderQty: 5,
              ordType: 'StopLimit',
              stopPx: stopPrice,
              price: limitPrice,
              ordStatus: 'New',
              execType: 'New',
              leavesQty: 5,
              cumQty: 0,
              timestamp: '2024-01-01T00:02:00.050Z',
            }),
            { status: 200 },
          ),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const instrument = new Instrument(
        { symbolNative: 'XBTUSD', symbolUni: 'XBTUSD' },
        { tradeBufferSize: 10 },
      );
      instrument.orderBook.bestBid = { price: 50_000, size: 1 };
      instrument.orderBook.bestAsk = { price: 50_010, size: 1 };

      const prepared = instrument.sell(5, stopPrice, { clOrdID, stopLimitPrice: limitPrice });
      expect(prepared.type).toBe('StopLimit');

      const orderPromise = core.sell(prepared);

      await clock.waitFor(() => fetchMock.mock.calls.length === 1);

      const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        symbol: 'XBTUSD',
        side: 'Sell',
        orderQty: 5,
        ordType: 'StopLimit',
        stopPx: stopPrice,
        price: limitPrice,
        clOrdID,
      });

      await server.waitForCompletion();
      await clock.wait(0);

      const order = await orderPromise;
      const snapshot = order.getSnapshot();
      expect(snapshot.status).toBe(OrderStatus.Filled);
      expect(snapshot.stopPrice).toBe(stopPrice);
      expect(snapshot.price).toBe(limitPrice);
      expect(snapshot.type).toBe('StopLimit');
    } finally {
      await cleanup();
    }
  });

  test('throws when stop-limit price crosses the top of book', () => {
    const instrument = new Instrument(
      { symbolNative: 'XBTUSD', symbolUni: 'XBTUSD' },
      { tradeBufferSize: 10 },
    );
    instrument.orderBook.bestBid = { price: 50_000, size: 1 };
    instrument.orderBook.bestAsk = { price: 50_010, size: 1 };

    expect(() => instrument.sell(2, 50_050, { stopLimitPrice: 50_040 })).toThrow(ValidationError);
  });
});
