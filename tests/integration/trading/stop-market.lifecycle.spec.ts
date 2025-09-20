import { jest } from '@jest/globals';

import { Instrument } from '../../../src/domain/instrument.js';
import { OrderStatus } from '../../../src/domain/order.js';

import { createScenario } from '../../helpers/ws-mock/scenario.js';
import { setupPrivateHarness } from '../../helpers/privateHarness.js';

const ORIGINAL_FETCH = global.fetch;

describe('BitMEX trading – stop-market lifecycle', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  test('submits stop-market payload and handles fill lifecycle', async () => {
    const clOrdID = 'stop-life-1';
    const stopPrice = 50_050;

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
          orderID: 'ws-stop-life-1',
          clOrdID,
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 10,
          ordType: 'Stop',
          stopPx: stopPrice,
          ordStatus: 'New',
          execType: 'New',
          leavesQty: 10,
          cumQty: 0,
          timestamp: '2024-01-01T00:00:01.000Z',
        },
      ])
      .delay(100)
      .sendUpdate('order', [
        {
          orderID: 'ws-stop-life-1',
          symbol: 'XBTUSD',
          leavesQty: 0,
          cumQty: 10,
          avgPx: 50_055,
          ordStatus: 'Filled',
          execType: 'Trade',
          lastQty: 10,
          lastPx: 50_055,
          stopPx: stopPrice,
          transactTime: '2024-01-01T00:00:02.000Z',
        },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:00:00.000Z' });
    const { hub, core, clock, server, cleanup } = harness;

    try {
      const fetchMock = jest.fn(
        async () =>
          new Response(
            JSON.stringify({
              orderID: 'ws-stop-life-1',
              clOrdID,
              symbol: 'XBTUSD',
              side: 'Buy',
              orderQty: 10,
              ordType: 'Stop',
              stopPx: stopPrice,
              ordStatus: 'New',
              execType: 'New',
              leavesQty: 10,
              cumQty: 0,
              timestamp: '2024-01-01T00:00:01.500Z',
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

      const prepared = instrument.buy(10, stopPrice, { clOrdID });
      expect(prepared.type).toBe('Stop');

      const orderPromise = core.buy(prepared);

      await clock.waitFor(() => fetchMock.mock.calls.length === 1);

      const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        symbol: 'XBTUSD',
        side: 'Buy',
        orderQty: 10,
        ordType: 'Stop',
        stopPx: stopPrice,
        clOrdID,
      });
      expect(body).not.toHaveProperty('price');

      await server.waitForCompletion();
      await clock.wait(0);

      const stored = hub.orders.getByClOrdId(clOrdID);
      expect(stored?.status).toBe(OrderStatus.Filled);

      const order = await orderPromise;
      const snapshot = order.getSnapshot();
      expect(snapshot.status).toBe(OrderStatus.Filled);
      expect(snapshot.stopPrice).toBe(stopPrice);
      expect(snapshot.type).toBe('Stop');
      expect(hub.orders.getInflightByClOrdId(clOrdID)).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  test('merges private updates arriving before REST response', async () => {
    const clOrdID = 'stop-race-1';
    const stopPrice = 49_980;

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
          orderID: 'ws-stop-race-1',
          clOrdID,
          symbol: 'XBTUSD',
          side: 'Buy',
          orderQty: 7,
          ordType: 'Stop',
          stopPx: stopPrice,
          ordStatus: 'New',
          execType: 'New',
          leavesQty: 7,
          cumQty: 0,
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ])
      .delay(40)
      .sendUpdate('order', [
        {
          orderID: 'ws-stop-race-1',
          symbol: 'XBTUSD',
          leavesQty: 0,
          cumQty: 7,
          avgPx: 49_990,
          ordStatus: 'Filled',
          execType: 'Trade',
          lastQty: 7,
          lastPx: 49_990,
          stopPx: stopPrice,
          transactTime: '2024-01-01T00:01:00.080Z',
        },
      ])
      .build();

    const harness = await setupPrivateHarness(scenario, { startTime: '2024-01-01T00:01:00.000Z' });
    const { hub, core, clock, server, cleanup } = harness;

    try {
      let resolveFetch: ((value: Response) => void) | undefined;
      const fetchMock = jest.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const instrument = new Instrument(
        { symbolNative: 'XBTUSD', symbolUni: 'XBTUSD' },
        { tradeBufferSize: 10 },
      );
      instrument.orderBook.bestBid = { price: 49_950, size: 1 };
      instrument.orderBook.bestAsk = { price: 49_970, size: 1 };

      const prepared = instrument.buy(7, stopPrice, { clOrdID });
      expect(prepared.type).toBe('Stop');

      const orderPromise = core.buy(prepared);

      await server.waitForCompletion();
      await clock.wait(0);

      const interim = hub.orders.getByClOrdId(clOrdID);
      expect(interim).toBeDefined();
      expect(interim!.getSnapshot().status).toBe(OrderStatus.Filled);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveFetch!(
        new Response(
          JSON.stringify({
            orderID: 'ws-stop-race-1',
            clOrdID,
            symbol: 'XBTUSD',
            side: 'Buy',
            orderQty: 7,
            ordType: 'Stop',
            stopPx: stopPrice,
            ordStatus: 'Filled',
            execType: 'Trade',
            leavesQty: 0,
            cumQty: 7,
            avgPx: 49_990,
            timestamp: '2024-01-01T00:01:00.150Z',
          }),
          { status: 200 },
        ),
      );

      const order = await orderPromise;
      expect(order).toBe(interim);
      expect(order.getSnapshot().status).toBe(OrderStatus.Filled);
      expect(hub.orders.getInflightByClOrdId(clOrdID)).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
