import { ExchangeHub } from '../../src/ExchangeHub';
import { handleInstrumentPartial } from '../../src/core/bitmex/channels/instrument';
import { OrderBookL2 } from '../../src/domain/orderBookL2';
import type { BitMex } from '../../src/core/bitmex/index';
import type { BitMexInstrument } from '../../src/core/bitmex/types';
import type { L2Row } from '../../src/types/orderbook';

class NoopWebSocket {
    readonly url: string;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;

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
    (globalThis as any).WebSocket = NoopWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
    (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
});

const INSTRUMENT_SNAPSHOT: BitMexInstrument[] = [
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

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

describe('OrderBookL2 (unit)', () => {
    test('reset builds price levels and aggregates best bid/ask', () => {
        const book = new OrderBookL2();
        const snapshot: L2Row[] = [
            { id: 1, side: 'buy', price: 100, size: 2 },
            { id: 2, side: 'buy', price: 101, size: 4 },
            { id: 3, side: 'buy', price: 101, size: 3 },
            { id: 4, side: 'sell', price: 103, size: 5 },
            { id: 5, side: 'sell', price: 102, size: 1 },
        ];

        book.reset(snapshot);

        expect(book.rows.size).toBe(5);
        expect(book.bestBid).toEqual({ price: 101, size: 7 });
        expect(book.bestAsk).toEqual({ price: 102, size: 1 });
        expect(book.outOfSync).toBe(false);
    });

    test('applyInsert adds rows and recomputes best quotes', () => {
        const book = new OrderBookL2();

        book.reset([
            { id: 1, side: 'buy', price: 100, size: 2 },
            { id: 2, side: 'sell', price: 105, size: 3 },
        ]);

        const delta = book.applyInsert([
            { id: 3, side: 'buy', price: 101, size: 1 },
            { id: 4, side: 'sell', price: 104, size: 2 },
            { id: 5, side: 'sell', price: 102, size: 4 },
        ]);

        expect(book.rows.size).toBe(5);
        expect(delta.changed).toEqual({ bids: 1, asks: 2 });
        expect(book.bestBid).toEqual({ price: 101, size: 1 });
        expect(book.bestAsk).toEqual({ price: 102, size: 4 });
        expect(book.outOfSync).toBe(false);
    });

    test('applyUpdate moves orders across price levels and updates best quotes', () => {
        const book = new OrderBookL2();

        book.reset([
            { id: 1, side: 'buy', price: 100, size: 3 },
            { id: 2, side: 'buy', price: 101, size: 1 },
            { id: 3, side: 'sell', price: 103, size: 2 },
            { id: 4, side: 'sell', price: 104, size: 5 },
        ]);

        const delta = book.applyUpdate([
            { id: 1, price: 102 },
            { id: 3, size: 1 },
        ]);

        expect(delta.changed).toEqual({ bids: 1, asks: 1 });
        expect(book.rows.get(1)).toEqual({ id: 1, side: 'buy', price: 102, size: 3 });
        expect(book.rows.get(3)).toEqual({ id: 3, side: 'sell', price: 103, size: 1 });
        expect(book.bestBid).toEqual({ price: 102, size: 3 });
        expect(book.bestAsk).toEqual({ price: 103, size: 1 });
        expect(book.outOfSync).toBe(false);
    });

    test('applyDelete removes rows and recomputes best quotes', () => {
        const book = new OrderBookL2();

        book.reset([
            { id: 1, side: 'buy', price: 100, size: 2 },
            { id: 2, side: 'buy', price: 101, size: 3 },
            { id: 3, side: 'sell', price: 105, size: 3 },
            { id: 4, side: 'sell', price: 102, size: 1 },
        ]);

        const delta = book.applyDelete([2, 4]);

        expect(delta.changed).toEqual({ bids: 1, asks: 1 });
        expect(book.rows.has(2)).toBe(false);
        expect(book.rows.has(4)).toBe(false);
        expect(book.bestBid).toEqual({ price: 100, size: 2 });
        expect(book.bestAsk).toEqual({ price: 105, size: 3 });
        expect(book.outOfSync).toBe(false);
    });

    test('marks outOfSync on inconsistent operations and reset clears the flag', () => {
        const book = new OrderBookL2();

        book.reset([{ id: 10, side: 'buy', price: 99, size: 2 }]);

        expect(book.outOfSync).toBe(false);

        const insertDelta = book.applyInsert([{ id: 10, side: 'buy', price: 100, size: 1 }]);

        expect(insertDelta.changed).toEqual({ bids: 0, asks: 0 });
        expect(book.outOfSync).toBe(true);

        const updateDelta = book.applyUpdate([{ id: 999, size: 5 }]);

        expect(updateDelta.changed).toEqual({ bids: 0, asks: 0 });
        expect(book.outOfSync).toBe(true);

        book.reset([{ id: 11, side: 'sell', price: 105, size: 4 }]);
        expect(book.outOfSync).toBe(false);
        expect(book.bestAsk).toEqual({ price: 105, size: 4 });
    });
});

describe('BitMEX core resolveInstrument', () => {
    test('returns the same instrument for native and unified symbols when mapping is enabled', () => {
        const hub = new ExchangeHub('BitMex', { isTest: true });
        const core = hub.Core as BitMex;

        handleInstrumentPartial(core, clone(INSTRUMENT_SNAPSHOT));

        const native = core.resolveInstrument('XBTUSD');
        const unifiedLower = core.resolveInstrument('btcusdt');
        const unifiedUpper = core.resolveInstrument('BTCUSDT');

        expect(native).toBeDefined();
        expect(unifiedLower).toBe(native);
        expect(unifiedUpper).toBe(native);
    });

    test('prefers native symbol variants when mapping is disabled', () => {
        const hub = new ExchangeHub('BitMex', { isTest: true, symbolMappingEnabled: false });
        const core = hub.Core as BitMex;

        handleInstrumentPartial(core, clone(INSTRUMENT_SNAPSHOT));

        const native = core.resolveInstrument('XBTUSD');
        const lowercaseNative = core.resolveInstrument('xbtusd');
        const unified = core.resolveInstrument('btcusdt');

        expect(native).toBeDefined();
        expect(lowercaseNative).toBe(native);
        expect(unified).toBeUndefined();
    });
});
