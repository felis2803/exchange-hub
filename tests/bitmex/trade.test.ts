import { ExchangeHub } from '../../src/ExchangeHub';
import { handleInstrumentPartial } from '../../src/core/bitmex/channels/instrument';
import { handleTradeInsert, handleTradePartial } from '../../src/core/bitmex/channels/trade';
import { TRADE_BUFFER_DEFAULT } from '../../src/core/bitmex/constants';
import { noop } from '../../src/utils/noop';
import type { BitMex } from '../../src/core/bitmex/index';
import type { BitMexInstrument } from '../../src/core/bitmex/types';
import type { BitmexTradeRaw } from '../../src/types/bitmex';
import type { Settings } from '../../src/types';

class FakeWebSocket {
    #url: string;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(url: string) {
        this.#url = url;
    }

    get url(): string {
        return this.#url;
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

    send(data: string): void {
        noop(data);
    }

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
        id?: string;
        timestamp?: string;
    },
): BitmexTradeRaw {
    const { index, baseTime, side, price, size, id, timestamp } = options;
    const ts = timestamp ?? new Date(baseTime + index * 1_000).toISOString();

    return {
        symbol,
        side: side ?? (index % 2 === 0 ? 'Buy' : 'Sell'),
        price: price ?? 50_000 + index,
        size: size ?? 10,
        timestamp: ts,
        trdMatchID: id ?? `${symbol}-${index}`,
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
        ).reverse();

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

    test('multiple insert batches maintain chronological and stable ordering', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(INSTRUMENT_FIXTURE));

        const instrument = hub.instruments.get('btcusdt');

        expect(instrument).toBeDefined();

        const baseTime = Date.parse('2024-01-01T00:00:00.000Z');

        handleTradePartial(core, [createTrade('XBTUSD', { index: 0, baseTime })]);

        const firstInsert: BitmexTradeRaw[] = [
            createTrade('XBTUSD', { index: 4, baseTime, price: 50_004 }),
            createTrade('XBTUSD', { index: 2, baseTime, price: 50_002 }),
        ];

        handleTradeInsert(core, firstInsert);

        const secondInsert: BitmexTradeRaw[] = [
            createTrade('XBTUSD', { index: 3, baseTime, price: 50_003 }),
            createTrade('XBTUSD', {
                index: 3,
                baseTime,
                id: 'XBTUSD-3b',
                timestamp: new Date(baseTime + 3 * 1_000).toISOString(),
                price: 50_003.5,
            }),
        ];

        handleTradeInsert(core, secondInsert);

        const snapshot = instrument!.trades.toArray();

        expect(snapshot).toHaveLength(5);
        expect(snapshot.map(trade => trade.id)).toEqual(['XBTUSD-0', 'XBTUSD-2', 'XBTUSD-3', 'XBTUSD-3b', 'XBTUSD-4']);

        for (let i = 1; i < snapshot.length; i += 1) {
            expect(snapshot[i].ts).toBeGreaterThanOrEqual(snapshot[i - 1].ts);
        }
    });

    test('skips duplicate trades identified by the same trdMatchID', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(INSTRUMENT_FIXTURE));

        const instrument = hub.instruments.get('btcusdt');

        expect(instrument).toBeDefined();

        const baseTime = Date.parse('2024-01-01T00:00:00.000Z');

        handleTradePartial(core, [createTrade('XBTUSD', { index: 0, baseTime })]);

        handleTradeInsert(core, [createTrade('XBTUSD', { index: 1, baseTime, id: 'dup-trade' })]);

        handleTradeInsert(core, [
            createTrade('XBTUSD', { index: 2, baseTime, id: 'dup-trade' }),
            createTrade('XBTUSD', { index: 3, baseTime, id: 'unique-trade' }),
        ]);

        const snapshot = instrument!.trades.toArray();

        expect(snapshot).toHaveLength(3);
        expect(snapshot.map(trade => trade.id)).toEqual(['XBTUSD-0', 'dup-trade', 'unique-trade']);
        expect(snapshot.filter(trade => trade.id === 'dup-trade')).toHaveLength(1);
    });

    test('emits events only for insert batches', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(INSTRUMENT_FIXTURE));

        const instrument = hub.instruments.get('btcusdt');

        expect(instrument).toBeDefined();

        const baseTime = Date.parse('2024-01-01T00:00:00.000Z');

        instrument!.setTradeEventEnabled(true);

        const updateListener = jest.fn();
        const tradeListener = jest.fn();

        instrument!.on('update', updateListener);
        instrument!.on('trade', tradeListener);

        handleTradePartial(core, [createTrade('XBTUSD', { index: 0, baseTime })]);

        expect(updateListener).not.toHaveBeenCalled();
        expect(tradeListener).not.toHaveBeenCalled();

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
        expect(changes.trades?.map(trade => trade.id)).toEqual(['XBTUSD-5', 'XBTUSD-6']);

        const [, tradePayload] = tradeListener.mock.calls[0];

        expect(tradePayload).toEqual(changes.trades);
    });

    test('works with symbol mapping enabled and disabled', () => {
        const { hub: mappedHub, core: mappedCore } = createHub({ symbolMappingEnabled: true });

        handleInstrumentPartial(mappedCore, clone(INSTRUMENT_FIXTURE));

        const mappedInstrumentNative = mappedCore.getInstrumentByNative('XBTUSD');

        expect(mappedInstrumentNative).toBeDefined();
        expect(mappedHub.instruments.get('btcusdt')).toBe(mappedInstrumentNative);
        expect(mappedCore.instruments.get('XBTUSD')).toBe(mappedInstrumentNative);

        handleTradeInsert(mappedCore, [
            createTrade('XBTUSD', {
                index: 1,
                baseTime: Date.parse('2024-01-01T00:00:00.000Z'),
            }),
        ]);
        expect(mappedInstrumentNative!.trades.toArray()).toHaveLength(1);
        expect(mappedCore.instruments.get('XBTUSD')).toBe(mappedInstrumentNative);

        const { hub: nativeHub, core: nativeCore } = createHub({ symbolMappingEnabled: false });

        handleInstrumentPartial(nativeCore, clone(INSTRUMENT_FIXTURE));

        expect(nativeHub.instruments.get('btcusdt')).toBeUndefined();

        const nativeInstrument = nativeCore.getInstrumentByNative('XBTUSD');

        expect(nativeInstrument).toBeDefined();
        expect(nativeCore.instruments.get('XBTUSD')).toBe(nativeInstrument);
        expect(nativeCore.instruments.get('btcusdt')).toBeUndefined();

        handleTradeInsert(nativeCore, [
            createTrade('XBTUSD', {
                index: 2,
                baseTime: Date.parse('2024-01-01T00:00:00.000Z'),
            }),
        ]);

        expect(nativeInstrument!.trades.toArray()).toHaveLength(1);
    });
});
