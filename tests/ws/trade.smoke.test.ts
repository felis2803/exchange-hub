import type { BitMexChannelMessage, BitMexInstrument } from '../../src/core/bitmex/types.js';
import { ExchangeHub } from '../../src/ExchangeHub.js';
import { handleInstrumentPartial } from '../../src/core/bitmex/channels/instrument.js';
import { TRADE_BUFFER_DEFAULT } from '../../src/core/bitmex/constants.js';
import type { BitMex } from '../../src/core/bitmex/index.js';
import type { BitmexTradeRaw } from '../../src/types/bitmex.js';

class ControlledWebSocket {
    static instances: ControlledWebSocket[] = [];

    readonly url: string;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;

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

beforeAll(() => {
    (globalThis as any).WebSocket = ControlledWebSocket;
});

afterAll(() => {
    (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
});

afterEach(() => {
    ControlledWebSocket.instances = [];
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

function createTrade(index: number): BitmexTradeRaw {
    return {
        symbol: 'XBTUSD',
        side: index % 2 === 0 ? 'Buy' : 'Sell',
        price: 50_000 + index,
        size: 5,
        timestamp: new Date(Date.parse('2024-01-01T00:00:00.000Z') + index * 1_000).toISOString(),
        trdMatchID: `trade-${index}`,
    };
}

describe('BitMEX trade channel smoke test', () => {
    test('processes partial and insert messages through mock WebSocket', async () => {
        const hub = new ExchangeHub('BitMex', { isTest: true });
        const core = hub.Core as BitMex;

        const socket = ControlledWebSocket.instances[0];

        expect(socket).toBeDefined();

        const connectPromise = hub.connect();

        socket!.simulateOpen();
        await connectPromise;

        handleInstrumentPartial(core, JSON.parse(JSON.stringify(INSTRUMENT_SNAPSHOT)));

        const instrument = hub.instruments.get('btcusdt');

        expect(instrument).toBeDefined();

        const updates: number[] = [];

        instrument!.on('update', () => {
            updates.push(instrument!.trades.toArray().length);
        });

        const partialMessage: BitMexChannelMessage<'trade'> = {
            table: 'trade',
            action: 'partial',
            data: [createTrade(0), createTrade(1), createTrade(2)],
        };

        socket!.simulateMessage(partialMessage);

        expect(updates).toHaveLength(0);
        expect(instrument!.trades.toArray()).toHaveLength(3);

        const insertMessage: BitMexChannelMessage<'trade'> = {
            table: 'trade',
            action: 'insert',
            data: [createTrade(3), createTrade(4)],
        };

        socket!.simulateMessage(insertMessage);

        const snapshot = instrument!.trades.toArray();

        expect(snapshot.length).toBeLessThanOrEqual(TRADE_BUFFER_DEFAULT);

        const ids = snapshot.map(trade => trade.id);
        const uniqueIds = Array.from(new Set(ids));

        expect(uniqueIds).toEqual(['trade-0', 'trade-1', 'trade-2', 'trade-3', 'trade-4']);
        expect(updates).toEqual([snapshot.length]);

        await hub.disconnect();
    });
});
