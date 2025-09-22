import type { ExchangeHub as ExchangeHubClass } from '../../src/ExchangeHub.js';
import type { handleInstrumentPartial as handleInstrumentPartialFn } from '../../src/core/bitmex/channels/instrument.js';
import type { BitMex } from '../../src/core/bitmex/index.js';
import type { BitMexChannelMessage, BitMexInstrument } from '../../src/core/bitmex/types.js';
import type { Logger } from '../../src/infra/logger.js';
import type { BitmexOrderBookL2Raw } from '../../src/types/bitmex.js';
import type { L2BatchDelta } from '../../src/types/orderbook.js';

const orderBookLogger: Logger = {
    level: jest.fn(() => 'debug'),
    setLevel: jest.fn(),
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

let ExchangeHub: typeof ExchangeHubClass;
let handleInstrumentPartial: typeof handleInstrumentPartialFn;

beforeAll(async () => {
    jest.resetModules();

    const loggerModule = await import('../../src/infra/logger.js');
    const actualCreateLogger = loggerModule.createLogger;

    jest.spyOn(loggerModule, 'createLogger').mockImplementation((namespace?: string) => {
        if (namespace === 'bitmex:orderbook') {
            return orderBookLogger;
        }

        return actualCreateLogger(namespace);
    });

    ({ ExchangeHub } = await import('../../src/ExchangeHub.js'));
    ({ handleInstrumentPartial } = await import('../../src/core/bitmex/channels/instrument.js'));

    (globalThis as any).WebSocket = ControlledWebSocket;
});

class ControlledWebSocket {
    static instances: ControlledWebSocket[] = [];

    public readonly url: string;
    public onmessage: ((event: { data: unknown }) => void) | null = null;
    public onopen: (() => void) | null = null;
    public onerror: ((err: unknown) => void) | null = null;
    public onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;

    #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(url: string) {
        this.url = url;
        ControlledWebSocket.instances.push(this);
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
        this.#emit('close', { code: 1000, reason: 'client-request' });
    }

    simulateOpen(): void {
        this.#emit('open');
    }

    simulateMessage(message: BitMexChannelMessage<any>): void {
        const payload = JSON.stringify(message);

        this.#emit('message', { data: payload });
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

afterAll(() => {
    jest.restoreAllMocks();
    (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
});

afterEach(() => {
    ControlledWebSocket.instances = [];
});

beforeEach(() => {
    orderBookLogger.debug.mockClear();
    orderBookLogger.warn.mockClear();
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

function buildMessage(
    action: BitMexChannelMessage<'orderBookL2'>['action'],
    data: BitmexOrderBookL2Raw[],
): BitMexChannelMessage<'orderBookL2'> {
    return {
        table: 'orderBookL2',
        action,
        data,
    };
}

describe('BitMEX orderBookL2 channel smoke test', () => {
    test('partial→insert→update→delete emit exactly one update per batch and trigger resubscribe on desync', async () => {
        const hub = new ExchangeHub('BitMex', { isTest: true });
        const core = hub.Core as BitMex;
        const socket = ControlledWebSocket.instances[0];

        expect(socket).toBeDefined();

        const connectPromise = hub.connect();

        socket!.simulateOpen();
        await connectPromise;

        handleInstrumentPartial(core, clone(INSTRUMENT_SNAPSHOT));

        const instrument = hub.instruments.get('btcusdt');

        expect(instrument).toBeDefined();

        const book = instrument!.orderBook;
        const events: L2BatchDelta[] = [];

        book.on('update', delta => events.push(delta));

        const partialData: BitmexOrderBookL2Raw[] = [
            { symbol: 'XBTUSD', id: 1_000_000_001, side: 'Buy', price: 99, size: 2 },
            { symbol: 'XBTUSD', id: 1_000_000_002, side: 'Buy', price: 99, size: 3 },
            { symbol: 'XBTUSD', id: 2_000_000_001, side: 'Sell', price: 100, size: 4 },
            { symbol: 'XBTUSD', id: 2_000_000_002, side: 'Sell', price: 101, size: 1 },
        ];

        socket!.simulateMessage(buildMessage('partial', partialData));

        expect(events).toHaveLength(1);
        expect(events[0].changed).toEqual({ bids: 2, asks: 2 });
        expect(book.bestBid).toEqual({ price: 99, size: 5 });
        expect(book.bestAsk).toEqual({ price: 100, size: 4 });
        expect(orderBookLogger.debug).toHaveBeenCalledTimes(1);
        expect(orderBookLogger.debug).toHaveBeenNthCalledWith(
            1,
            'BitMEX orderBookL2 partial processed for %s',
            'XBTUSD',
            {
                batchSize: partialData.length,
                bestBid: { price: 99, size: 5 },
                bestAsk: { price: 100, size: 4 },
            },
        );

        events.length = 0;

        const insertData: BitmexOrderBookL2Raw[] = [
            { symbol: 'XBTUSD', id: 1_000_000_003, side: 'Buy', price: 100, size: 1 },
            { symbol: 'XBTUSD', id: 2_000_000_003, side: 'Sell', price: 99.5, size: 2 },
        ];

        socket!.simulateMessage(buildMessage('insert', insertData));

        expect(events).toHaveLength(1);
        expect(events[0].changed).toEqual({ bids: 1, asks: 1 });
        expect(book.bestBid).toEqual({ price: 100, size: 1 });
        expect(book.bestAsk).toEqual({ price: 99.5, size: 2 });
        expect(orderBookLogger.debug).toHaveBeenCalledTimes(2);
        expect(orderBookLogger.debug).toHaveBeenNthCalledWith(
            2,
            'BitMEX orderBookL2 insert processed for %s',
            'XBTUSD',
            {
                batchSize: insertData.length,
                changed: { bids: 1, asks: 1 },
                bestBid: { price: 100, size: 1 },
                bestAsk: { price: 99.5, size: 2 },
                outOfSync: false,
            },
        );

        events.length = 0;

        const updateData: BitmexOrderBookL2Raw[] = [
            { symbol: 'XBTUSD', id: 1_000_000_002, side: 'Buy', price: 100.2 },
            { symbol: 'XBTUSD', id: 2_000_000_001, side: 'Sell', size: 2 },
        ];

        socket!.simulateMessage(buildMessage('update', updateData));

        expect(events).toHaveLength(1);
        expect(events[0].changed).toEqual({ bids: 1, asks: 1 });
        expect(book.bestBid).toEqual({ price: 100.2, size: 3 });
        expect(book.bestAsk).toEqual({ price: 99.5, size: 2 });
        expect(orderBookLogger.debug).toHaveBeenCalledTimes(3);
        expect(orderBookLogger.debug).toHaveBeenNthCalledWith(
            3,
            'BitMEX orderBookL2 update processed for %s',
            'XBTUSD',
            {
                batchSize: updateData.length,
                changed: { bids: 1, asks: 1 },
                bestBid: { price: 100.2, size: 3 },
                bestAsk: { price: 99.5, size: 2 },
                outOfSync: false,
            },
        );

        events.length = 0;

        const deleteData: BitmexOrderBookL2Raw[] = [
            { symbol: 'XBTUSD', id: 2_000_000_003, side: 'Sell' },
            { symbol: 'XBTUSD', id: 1_000_000_003, side: 'Buy' },
        ];

        socket!.simulateMessage(buildMessage('delete', deleteData));

        expect(events).toHaveLength(1);
        expect(events[0].changed).toEqual({ bids: 1, asks: 1 });
        expect(book.bestBid).toEqual({ price: 100.2, size: 3 });
        expect(book.bestAsk).toEqual({ price: 100, size: 2 });
        expect(orderBookLogger.debug).toHaveBeenCalledTimes(4);
        expect(orderBookLogger.debug).toHaveBeenNthCalledWith(
            4,
            'BitMEX orderBookL2 delete processed for %s',
            'XBTUSD',
            {
                batchSize: deleteData.length,
                changed: { bids: 1, asks: 1 },
                bestBid: { price: 100.2, size: 3 },
                bestAsk: { price: 100, size: 2 },
                outOfSync: false,
            },
        );

        events.length = 0;

        const resubscribeSpy = jest.spyOn(core, 'resubscribeOrderBook');

        const badUpdate: BitmexOrderBookL2Raw[] = [{ symbol: 'XBTUSD', id: 9_999_999_999, side: 'Buy', size: 5 }];

        socket!.simulateMessage(buildMessage('update', badUpdate));

        expect(events).toHaveLength(1);
        expect(events[0].changed).toEqual({ bids: 0, asks: 0 });
        expect(book.outOfSync).toBe(true);
        expect(orderBookLogger.debug).toHaveBeenCalledTimes(5);
        expect(orderBookLogger.debug).toHaveBeenNthCalledWith(
            5,
            'BitMEX orderBookL2 update processed for %s',
            'XBTUSD',
            {
                batchSize: badUpdate.length,
                changed: { bids: 0, asks: 0 },
                bestBid: { price: 100.2, size: 3 },
                bestAsk: { price: 100, size: 2 },
                outOfSync: true,
            },
        );
        expect(orderBookLogger.warn).toHaveBeenCalledTimes(1);
        expect(orderBookLogger.warn).toHaveBeenCalledWith(
            'BitMEX orderBookL2 update out-of-sync for %s, requesting resubscribe',
            'XBTUSD',
        );
        expect(resubscribeSpy).toHaveBeenCalledTimes(1);
        expect(resubscribeSpy).toHaveBeenCalledWith('XBTUSD');

        resubscribeSpy.mockRestore();

        await hub.disconnect();
    });
});
