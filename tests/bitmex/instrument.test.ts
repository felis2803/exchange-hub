import { ExchangeHub } from '../../src/ExchangeHub';
import {
    handleInstrumentDelete,
    handleInstrumentInsert,
    handleInstrumentPartial,
    handleInstrumentUpdate,
} from '../../src/core/bitmex/channels/instrument';
import { Instrument } from '../../src/domain/instrument';
import { mapSymbolNativeToUni, mapSymbolUniToNative } from '../../src/utils/symbolMapping';
import type { BitMex } from '../../src/core/bitmex/index';
import type { BitMexInstrument } from '../../src/core/bitmex/types';
import type { Settings } from '../../src/types';

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
    }

    #emit(event: string, ...args: unknown[]): void {
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

const PARTIAL_FIXTURE: BitMexInstrument[] = [
    {
        symbol: 'XBTUSD',
        rootSymbol: 'XBT',
        state: 'Open',
        typ: 'FFWCSX',
        quoteCurrency: 'USD',
        underlying: 'XBT',
        lotSize: 100,
        tickSize: 0.5,
        lastPrice: 65_000.5,
        markPrice: 65_010,
        fundingRate: 0.0001,
        indicativeFundingRate: 0.0002,
        fundingTimestamp: '2024-06-24T12:00:00.000Z',
        fundingInterval: '2024-06-24T08:00:00.000Z',
        turnover24h: 1_234_567_890,
        volume24h: 987_654_321,
        openInterest: 250_000_000,
        limitDownPrice: 10_000,
        limitUpPrice: 100_000,
        maxPrice: 150_000,
        timestamp: '2024-06-24T12:34:56.789Z',
    },
    {
        symbol: 'ETHUSDT',
        rootSymbol: 'ETH',
        state: 'Open',
        typ: 'FFWCSX',
        quoteCurrency: 'USDT',
        underlying: 'ETH',
        lotSize: 1,
        tickSize: 0.05,
        lastPrice: 3_500,
        markPrice: 3_505,
        fundingRate: 0.0003,
        indicativeFundingRate: 0.00035,
        fundingTimestamp: '2024-06-24T12:05:00.000Z',
        turnover24h: 543_210_987,
        volume24h: 34_567_890,
        openInterest: 1_500_000,
        limitDownPrice: 2_000,
        limitUpPrice: 5_000,
        maxPrice: 6_000,
        timestamp: '2024-06-24T12:35:10.000Z',
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

describe('BitMEX instrument channel', () => {
    test('partial snapshot initializes instruments without emitting update events', () => {
        const emitSpy = jest.spyOn(Instrument.prototype, 'emit');
        const { core } = createHub();

        try {
            handleInstrumentPartial(core, clone(PARTIAL_FIXTURE));

            const updateEmits = emitSpy.mock.calls.filter(call => call[0] === 'update');

            expect(updateEmits).toHaveLength(0);
        } finally {
            emitSpy.mockRestore();
        }
    });

    test('handles partial snapshot and exposes instruments via mapping', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(PARTIAL_FIXTURE));

        const btcInstrument = hub.instruments.get('btcusdt');

        expect(btcInstrument).toBeDefined();
        expect(btcInstrument?.symbolNative).toBe('XBTUSD');
        expect(btcInstrument?.symbolUni).toBe('btcusdt.perp');
        expect(btcInstrument?.lotSize).toBe(100);
        expect(btcInstrument?.tickSize).toBe(0.5);
        expect(btcInstrument?.fundingRate).toBe(0.0001);
        expect(btcInstrument?.priceFilters?.limitUpPrice).toBe(100_000);

        expect(hub.instruments.get('btcusdt.perp')).toBe(btcInstrument);
        expect(hub.instruments.get('XBTUSD')).toBe(btcInstrument);
        expect(hub.instruments.get('BTCUSDT')).toBe(btcInstrument);

        const ethInstrument = hub.instruments.get('ethusdt');

        expect(ethInstrument).toBeDefined();
        expect(ethInstrument?.priceFilters?.limitDownPrice).toBe(2_000);
    });

    test('inserts new instruments and registers aliases', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(PARTIAL_FIXTURE));

        const solInstrument: BitMexInstrument = {
            symbol: 'SOLUSDT',
            rootSymbol: 'SOL',
            state: 'Open',
            typ: 'FFWCSX',
            quoteCurrency: 'USDT',
            underlying: 'SOL',
            lotSize: 10,
            tickSize: 0.01,
            lastPrice: 150,
            limitDownPrice: 50,
            limitUpPrice: 500,
            maxPrice: 750,
            timestamp: '2024-06-24T12:40:00.000Z',
        };

        handleInstrumentInsert(core, [solInstrument]);

        const cached = hub.instruments.get('solusdt');

        expect(cached).toBeDefined();
        expect(cached?.symbolUni).toBe('solusdt.perp');
        expect(cached?.priceFilters?.limitDownPrice).toBe(50);
        expect(hub.instruments.get('SOLUSDT')).toBe(cached);
    });

    test('updates existing instruments and emits update event', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(PARTIAL_FIXTURE));

        const instrument = hub.instruments.get('btcusdt');

        expect(instrument).toBeDefined();

        const updateListener = jest.fn();

        instrument!.on('update', updateListener);

        const updateData: BitMexInstrument = {
            symbol: 'XBTUSD',
            lastPrice: 66_000,
            fundingRate: 0.00015,
            limitUpPrice: 120_000,
            timestamp: '2024-06-24T13:00:00.000Z',
        };

        handleInstrumentUpdate(core, [updateData]);

        expect(instrument!.lastPrice).toBe(66_000);
        expect(instrument!.fundingRate).toBe(0.00015);
        expect(instrument!.priceFilters.limitUpPrice).toBe(120_000);
        expect(instrument!.timestamp).toBe('2024-06-24T13:00:00.000Z');
        expect(updateListener).toHaveBeenCalledTimes(1);

        const [emittedInstrument, changes] = updateListener.mock.calls[0];

        expect(emittedInstrument).toBe(instrument);
        expect(changes).toEqual({
            lastPrice: 66_000,
            fundingRate: 0.00015,
            timestamp: '2024-06-24T13:00:00.000Z',
            priceFilters: { limitUpPrice: 120_000 },
        });
    });

    test('does not emit update event when values remain the same', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(PARTIAL_FIXTURE));

        const instrument = hub.instruments.get('btcusdt');

        expect(instrument).toBeDefined();

        const updateListener = jest.fn();

        instrument!.on('update', updateListener);

        handleInstrumentUpdate(core, [{ symbol: 'XBTUSD', lastPrice: instrument!.lastPrice ?? undefined }]);

        expect(updateListener).not.toHaveBeenCalled();
    });

    test('marks instruments as delisted on delete', () => {
        const { hub, core } = createHub();

        handleInstrumentPartial(core, clone(PARTIAL_FIXTURE));

        const ethInstrument = hub.instruments.get('ethusdt');

        expect(ethInstrument).toBeDefined();

        const updateListener = jest.fn();

        ethInstrument!.on('update', updateListener);

        handleInstrumentDelete(core, [{ symbol: 'ETHUSDT' } as BitMexInstrument]);

        expect(ethInstrument?.status).toBe('delisted');
        expect(updateListener).toHaveBeenCalledTimes(1);
        expect(updateListener).toHaveBeenCalledWith(ethInstrument, { status: 'delisted' });

        handleInstrumentUpdate(core, [
            {
                symbol: 'ETHUSDT',
                lastPrice: 4_200,
                fundingRate: 0.0005,
                state: 'Open',
            } as BitMexInstrument,
        ]);

        expect(updateListener).toHaveBeenCalledTimes(1);
        expect(ethInstrument?.lastPrice).toBe(3_500);
        expect(ethInstrument?.fundingRate).toBe(0.0003);
        expect(ethInstrument?.status).toBe('delisted');

        handleInstrumentInsert(core, [
            {
                symbol: 'ETHUSDT',
                lastPrice: 4_250,
                fundingRate: 0.00055,
                state: 'Open',
                quoteCurrency: 'USDT',
            } as BitMexInstrument,
        ]);

        expect(updateListener).toHaveBeenCalledTimes(2);
        expect(updateListener.mock.calls[1][1]).toEqual({
            lastPrice: 4_250,
            fundingRate: 0.00055,
            status: 'open',
        });
        expect(ethInstrument?.status).toBe('open');
        expect(ethInstrument?.lastPrice).toBe(4_250);
        expect(ethInstrument?.fundingRate).toBe(0.00055);
    });

    test('symbol mapping utilities convert between native and unified symbols', () => {
        expect(mapSymbolNativeToUni('XBTUSD')).toBe('btcusdt.perp');
        expect(mapSymbolNativeToUni('ETHUSDT')).toBe('ethusdt.perp');
        expect(mapSymbolNativeToUni('XBTUSD', { enabled: false })).toBe('XBTUSD');

        expect(mapSymbolUniToNative('btcusdt.perp')).toBe('XBTUSD');
        expect(mapSymbolUniToNative('btcusdt')).toBe('XBTUSD');
        expect(mapSymbolUniToNative('btcusdt.perp', { enabled: false })).toBe('btcusdt.perp');
    });

    test('disabling symbol mapping keeps native symbols only', () => {
        const { hub, core } = createHub({ symbolMappingEnabled: false });

        handleInstrumentPartial(core, clone(PARTIAL_FIXTURE));

        expect(hub.instruments.get('btcusdt')).toBeUndefined();
        expect(hub.instruments.get('btcusdt.perp')).toBeUndefined();

        const nativeInstrument = hub.instruments.get('XBTUSD');

        expect(nativeInstrument).toBeDefined();
        expect(nativeInstrument?.symbolUni).toBe('XBTUSD');
        expect(hub.instruments.get('xbtusd')).toBe(nativeInstrument);
    });
});
