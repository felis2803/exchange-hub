import { ExchangeHub } from '../../src/ExchangeHub.js';
import { handleInstrumentPartial } from '../../src/cores/bitmex/channels/instrument.js';
import { handleTradeInsert, handleTradePartial } from '../../src/cores/bitmex/channels/trade.js';
import { TRADE_BUFFER_DEFAULT } from '../../src/cores/bitmex/constants.js';

import type { BitMex } from '../../src/cores/bitmex/index.js';
import type { BitMexInstrument } from '../../src/cores/bitmex/types.js';
import type { BitmexTradeRaw } from '../../src/types/bitmex.js';
import type { Settings } from '../../src/types.js';

class FakeWebSocket {
  public readonly url: string;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }

    this.#listeners.get(event)!.add(listener);
  }

  removeEventListener(event: string, listener: (...args: unknown[]) => void): void {
    this.#listeners.get(event)?.delete(listener);
  }

  send(_data: string): void {}

  close(): void {
    this.#emit('close');
  }

  simulateOpen(): void {
    this.#emit('open');
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data });
    this.#emit('message', { data });
  }

  #emit(event: string, ...args: unknown[]): void {
    const handler = (this as any)[`on${event}`];
    if (typeof handler === 'function') {
      handler(...args);
    }

    for (const listener of this.#listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

const ORIGINAL_WEBSOCKET = (globalThis as any).WebSocket;

beforeAll(() => {
  (globalThis as any).WebSocket = FakeWebSocket;
});

afterAll(() => {
  (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
});

const INSTRUMENT_FIXTURE: BitMexInstrument[] = [
  {
    symbol: 'XBTUSD',
    state: 'Open',
    typ: 'FFWCSX',
    quoteCurrency: 'USD',
    underlying: 'XBT',
    lotSize: 100,
    tickSize: 0.5,
    lastPrice: 50_000,
    timestamp: '2024-01-01T00:00:00.000Z',
  },
];

function createHub(settings: Partial<Settings> = {}) {
  const hub = new ExchangeHub('BitMex', { isTest: true, ...settings });
  const core = hub.Core as BitMex;

  return { hub, core };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createTrade(
  symbol: string,
  options: {
    index: number;
    baseTime: number;
    side?: 'Buy' | 'Sell';
    price?: number;
    size?: number;
  },
): BitmexTradeRaw {
  const { index, baseTime, side, price, size } = options;
  const ts = new Date(baseTime + index * 1_000).toISOString();

  return {
    symbol,
    side: side ?? (index % 2 === 0 ? 'Buy' : 'Sell'),
    price: price ?? 50_000 + index,
    size: size ?? 10,
    timestamp: ts,
    trdMatchID: `${symbol}-${index}`,
  };
}

describe('BitMEX trade channel', () => {
  test('partial snapshot keeps only the newest trades within the buffer', () => {
    const { hub, core } = createHub();

    handleInstrumentPartial(core, clone(INSTRUMENT_FIXTURE));

    const instrument = hub.instruments.get('btcusdt');
    expect(instrument).toBeDefined();

    const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
    const total = TRADE_BUFFER_DEFAULT + 200;
    const trades: BitmexTradeRaw[] = Array.from({ length: total }, (_, index) =>
      createTrade('XBTUSD', { index, baseTime }),
    );

    handleTradePartial(core, trades);

    const snapshot = instrument!.trades.toArray();
    expect(snapshot).toHaveLength(TRADE_BUFFER_DEFAULT);

    const expectedStart = total - TRADE_BUFFER_DEFAULT;
    expect(snapshot[0]?.id).toBe(`XBTUSD-${expectedStart}`);
    expect(snapshot[snapshot.length - 1]?.id).toBe(`XBTUSD-${total - 1}`);

    for (let i = 1; i < snapshot.length; i += 1) {
      expect(snapshot[i].ts).toBeGreaterThanOrEqual(snapshot[i - 1].ts);
    }
  });

  test('insert batches are ordered by timestamp and extend the buffer', () => {
    const { hub, core } = createHub();
    handleInstrumentPartial(core, clone(INSTRUMENT_FIXTURE));

    const instrument = hub.instruments.get('btcusdt');
    expect(instrument).toBeDefined();

    const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
    handleTradePartial(core, [createTrade('XBTUSD', { index: 0, baseTime })]);

    const insertBatch: BitmexTradeRaw[] = [
      createTrade('XBTUSD', { index: 3, baseTime, price: 50_003 }),
      createTrade('XBTUSD', { index: 2, baseTime, price: 50_002 }),
      createTrade('XBTUSD', { index: 4, baseTime, price: 50_004 }),
    ];

    handleTradeInsert(core, insertBatch);

    const snapshot = instrument!.trades.toArray();
    expect(snapshot.map((trade) => trade.id)).toEqual([
      'XBTUSD-0',
      'XBTUSD-2',
      'XBTUSD-3',
      'XBTUSD-4',
    ]);

    for (let i = 1; i < snapshot.length; i += 1) {
      expect(snapshot[i].ts).toBeGreaterThanOrEqual(snapshot[i - 1].ts);
    }
  });

  test('emits update and trade events with inserted batches', () => {
    const { hub, core } = createHub();
    handleInstrumentPartial(core, clone(INSTRUMENT_FIXTURE));

    const instrument = hub.instruments.get('btcusdt');
    expect(instrument).toBeDefined();

    const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
    handleTradePartial(core, [createTrade('XBTUSD', { index: 0, baseTime })]);

    instrument!.setTradeEventEnabled(true);

    const updateListener = jest.fn();
    const tradeListener = jest.fn();
    instrument!.on('update', updateListener);
    instrument!.on('trade', tradeListener);

    const insertBatch: BitmexTradeRaw[] = [
      createTrade('XBTUSD', { index: 5, baseTime }),
      createTrade('XBTUSD', { index: 6, baseTime }),
    ];

    handleTradeInsert(core, insertBatch);

    expect(updateListener).toHaveBeenCalledTimes(1);
    expect(tradeListener).toHaveBeenCalledTimes(1);

    const [, changes] = updateListener.mock.calls[0];
    expect(changes.trades).toBeDefined();
    expect(changes.trades).toHaveLength(2);
    expect(changes.trades?.map((trade) => trade.id)).toEqual(['XBTUSD-5', 'XBTUSD-6']);

    const [, tradePayload] = tradeListener.mock.calls[0];
    expect(tradePayload).toEqual(changes.trades);
  });

  test('works with symbol mapping enabled and disabled', () => {
    const { hub: mappedHub, core: mappedCore } = createHub({ symbolMappingEnabled: true });
    handleInstrumentPartial(mappedCore, clone(INSTRUMENT_FIXTURE));

    const mappedInstrumentNative = mappedCore.getInstrumentByNative('XBTUSD');
    expect(mappedInstrumentNative).toBeDefined();
    expect(mappedHub.instruments.get('btcusdt')).toBe(mappedInstrumentNative);

    handleTradeInsert(mappedCore, [
      createTrade('XBTUSD', {
        index: 1,
        baseTime: Date.parse('2024-01-01T00:00:00.000Z'),
      }),
    ]);
    expect(mappedInstrumentNative!.trades.toArray()).toHaveLength(1);

    const { hub: nativeHub, core: nativeCore } = createHub({ symbolMappingEnabled: false });
    handleInstrumentPartial(nativeCore, clone(INSTRUMENT_FIXTURE));

    expect(nativeHub.instruments.get('btcusdt')).toBeUndefined();
    const nativeInstrument = nativeCore.getInstrumentByNative('XBTUSD');
    expect(nativeInstrument).toBeDefined();

    handleTradeInsert(nativeCore, [
      createTrade('XBTUSD', {
        index: 2,
        baseTime: Date.parse('2024-01-01T00:00:00.000Z'),
      }),
    ]);

    expect(nativeInstrument!.trades.toArray()).toHaveLength(1);
  });
});
