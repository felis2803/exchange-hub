import type { BitMexChannelMessage, BitMexWallet } from '../../../src/core/bitmex/types.js';
import type { DomainUpdate } from '../../../src/core/types.js';
import type { WalletSnapshot } from '../../../src/domain/wallet.js';
import { ExchangeHub } from '../../../src/ExchangeHub.js';
import { METRICS } from '../../../src/infra/metrics-private.js';
import { getCounterValue, getHistogramValues, resetMetrics } from '../../../src/infra/metrics.js';

const ORIGINAL_WEBSOCKET = (globalThis as any).WebSocket;

type WalletUpdateEvent = {
    snapshot: WalletSnapshot;
    diff: DomainUpdate<WalletSnapshot>;
    reason?: string;
};

describe('BitMEX wallet stream', () => {
    beforeAll(() => {
        (globalThis as any).WebSocket = ControlledWebSocket;
    });

    afterAll(() => {
        (globalThis as any).WebSocket = ORIGINAL_WEBSOCKET;
    });

    beforeEach(() => {
        resetMetrics();
        ControlledWebSocket.instances = [];
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('partial snapshots, updates, duplicates, and resync keep wallet state consistent', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2024-01-01T00:00:05.000Z'));

        const { hub, socket } = await createConnectedHub();
        const labels = { env: 'testnet', table: 'wallet' } as const;

        const partialData: BitMexWallet[] = [
            {
                account: 12345,
                currency: 'XBt',
                amount: 1_000_000,
                pendingCredit: 0,
                pendingDebit: 0,
                confirmedDebit: 0,
                transferIn: 100,
                transferOut: 0,
                deposited: 100,
                withdrawn: 0,
                timestamp: '2024-01-01T00:00:00.000Z',
            },
        ];

        socket.simulateMessage(buildMessage('partial', partialData));

        const wallet = hub.wallets.get('12345');

        expect(wallet).toBeDefined();

        const partialSnapshot = wallet!.getSnapshot();

        expect(partialSnapshot).toEqual({
            accountId: '12345',
            balances: {
                xbt: {
                    currency: 'XBT',
                    amount: 1_000_000,
                    pendingCredit: 0,
                    pendingDebit: 0,
                    confirmedDebit: 0,
                    transferIn: 100,
                    transferOut: 0,
                    deposited: 100,
                    withdrawn: 0,
                    timestamp: '2024-01-01T00:00:00.000Z',
                },
            },
            updatedAt: '2024-01-01T00:00:00.000Z',
        });

        expect(getCounterValue(METRICS.walletUpdateCount, labels)).toBe(1);
        expect(getHistogramValues(METRICS.snapshotAgeSec, labels)).toEqual([5]);

        const events: WalletUpdateEvent[] = [];
        const handler = (snapshot: WalletSnapshot, diff: DomainUpdate<WalletSnapshot>, reason?: string) => {
            events.push({ snapshot, diff, reason });
        };

        wallet!.on('update', handler);

        try {
            jest.setSystemTime(new Date('2024-01-01T00:00:06.000Z'));

            const updateData: BitMexWallet[] = [
                {
                    account: 12345,
                    currency: 'XBt',
                    amount: 1_100_000,
                    transferIn: 150,
                    timestamp: '2024-01-01T00:00:02.000Z',
                },
            ];

            socket.simulateMessage(buildMessage('update', updateData));

            expect(events).toHaveLength(1);

            const firstUpdate = events[0];

            expect(new Set(firstUpdate.diff.changed)).toEqual(new Set(['balances', 'updatedAt']));
            expect(firstUpdate.reason).toBe('ws:update');
            expect(firstUpdate.snapshot.balances.xbt.amount).toBe(1_100_000);
            expect(firstUpdate.snapshot.balances.xbt.transferIn).toBe(150);
            expect(firstUpdate.snapshot.updatedAt).toBe('2024-01-01T00:00:02.000Z');

            expect(getCounterValue(METRICS.walletUpdateCount, labels)).toBe(2);

            const histogramAfterUpdate = getHistogramValues(METRICS.snapshotAgeSec, labels);

            expect(histogramAfterUpdate).toHaveLength(2);
            expect(histogramAfterUpdate[1]).toBeCloseTo(4);

            events.length = 0;

            jest.setSystemTime(new Date('2024-01-01T00:00:07.000Z'));

            const duplicateData: BitMexWallet[] = [
                {
                    account: 12345,
                    currency: 'XBt',
                    amount: 1_100_000,
                    transferIn: 150,
                    timestamp: '2024-01-01T00:00:02.000Z',
                },
            ];

            socket.simulateMessage(buildMessage('update', duplicateData));

            const staleData: BitMexWallet[] = [
                {
                    account: 12345,
                    currency: 'XBt',
                    amount: 900_000,
                    timestamp: '2024-01-01T00:00:01.000Z',
                },
            ];

            socket.simulateMessage(buildMessage('update', staleData));

            expect(events).toHaveLength(0);
            expect(getCounterValue(METRICS.walletUpdateCount, labels)).toBe(2);

            jest.setSystemTime(new Date('2024-01-01T00:05:05.000Z'));

            const resyncPartial: BitMexWallet[] = [
                {
                    account: 12345,
                    currency: 'XBt',
                    amount: 500_000,
                    deposited: 200,
                    withdrawn: 50,
                    timestamp: '2024-01-01T00:05:00.000Z',
                },
                {
                    account: 12345,
                    currency: 'USDT',
                    amount: 2_000,
                    pendingCredit: 10,
                    timestamp: '2024-01-01T00:05:00.000Z',
                },
            ];

            socket.simulateMessage(buildMessage('partial', resyncPartial));

            expect(events).toHaveLength(1);

            const resyncEvent = events[0];

            expect(resyncEvent.reason).toBe('ws:resync');
            expect(new Set(resyncEvent.diff.changed)).toEqual(new Set(['balances', 'updatedAt']));
            expect(resyncEvent.snapshot.updatedAt).toBe('2024-01-01T00:05:00.000Z');
            expect(resyncEvent.snapshot.balances).toMatchObject({
                usdt: {
                    currency: 'USDT',
                    amount: 2_000,
                    pendingCredit: 10,
                    timestamp: '2024-01-01T00:05:00.000Z',
                },
                xbt: {
                    currency: 'XBT',
                    amount: 500_000,
                    deposited: 200,
                    withdrawn: 50,
                    timestamp: '2024-01-01T00:05:00.000Z',
                },
            });

            expect(getCounterValue(METRICS.walletUpdateCount, labels)).toBe(3);

            const histogramAfterResync = getHistogramValues(METRICS.snapshotAgeSec, labels);

            expect(histogramAfterResync).toHaveLength(3);
            expect(histogramAfterResync[2]).toBeCloseTo(5);

            events.length = 0;

            jest.setSystemTime(new Date('2024-01-01T00:05:06.000Z'));

            const postResyncUpdate: BitMexWallet[] = [
                {
                    account: 12345,
                    currency: 'USDT',
                    pendingCredit: 20,
                    timestamp: '2024-01-01T00:05:05.000Z',
                },
            ];

            socket.simulateMessage(buildMessage('update', postResyncUpdate));

            expect(events).toHaveLength(1);

            const finalEvent = events[0];

            expect(finalEvent.reason).toBe('ws:update');
            expect(new Set(finalEvent.diff.changed)).toEqual(new Set(['balances', 'updatedAt']));
            expect(finalEvent.snapshot.balances.usdt.pendingCredit).toBe(20);
            expect(finalEvent.snapshot.balances.xbt.amount).toBe(500_000);
            expect(finalEvent.snapshot.updatedAt).toBe('2024-01-01T00:05:05.000Z');

            expect(getCounterValue(METRICS.walletUpdateCount, labels)).toBe(4);

            const histogramFinal = getHistogramValues(METRICS.snapshotAgeSec, labels);

            expect(histogramFinal).toHaveLength(4);
            expect(histogramFinal[3]).toBeCloseTo(1);
        } finally {
            wallet?.off('update', handler);
            await hub.disconnect();
        }
    });

    test('dedupes wallet rows within a batch and applies the newest state once', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2024-01-01T00:00:02.000Z'));

        const { hub, socket } = await createConnectedHub();
        const labels = { env: 'testnet', table: 'wallet' } as const;

        const partialData: BitMexWallet[] = [
            {
                account: 12345,
                currency: 'XBt',
                amount: 750_000,
                deposited: 50,
                timestamp: '2024-01-01T00:00:00.000Z',
            },
            {
                account: 12345,
                currency: 'USDT',
                amount: 1_000,
                pendingCredit: 5,
                timestamp: '2024-01-01T00:00:00.000Z',
            },
        ];

        socket.simulateMessage(buildMessage('partial', partialData));

        const wallet = hub.wallets.get('12345');

        expect(wallet).toBeDefined();

        const events: WalletUpdateEvent[] = [];
        const handler = (snapshot: WalletSnapshot, diff: DomainUpdate<WalletSnapshot>, reason?: string) => {
            events.push({ snapshot, diff, reason });
        };

        wallet!.on('update', handler);

        try {
            jest.setSystemTime(new Date('2024-01-01T00:00:12.000Z'));

            const batchedUpdate: BitMexWallet[] = [
                {
                    account: 12345,
                    currency: 'XBt',
                    amount: 1_500_000,
                    deposited: 200,
                    timestamp: '2024-01-01T00:00:10.000Z',
                },
                {
                    account: 12345,
                    currency: 'USDT',
                    pendingCredit: 15,
                    timestamp: '2024-01-01T00:00:08.500Z',
                },
                {
                    account: 12345,
                    currency: 'XBt',
                    amount: 1_200_000,
                    timestamp: '2024-01-01T00:00:09.000Z',
                },
                {
                    account: 12345,
                    currency: 'USDT',
                    pendingCredit: 55,
                    pendingDebit: 5,
                    timestamp: '2024-01-01T00:00:08.600Z',
                },
                {
                    account: 12345,
                    currency: 'USDT',
                    pendingCredit: 55,
                    pendingDebit: 5,
                    timestamp: '2024-01-01T00:00:08.600Z',
                },
            ];

            socket.simulateMessage(buildMessage('update', batchedUpdate));

            expect(events).toHaveLength(1);

            const [batchEvent] = events;

            expect(batchEvent.reason).toBe('ws:update');
            expect(new Set(batchEvent.diff.changed)).toEqual(new Set(['balances', 'updatedAt']));
            expect(batchEvent.snapshot.balances.xbt.amount).toBe(1_500_000);
            expect(batchEvent.snapshot.balances.xbt.deposited).toBe(200);
            expect(batchEvent.snapshot.balances.usdt.pendingCredit).toBe(55);
            expect(batchEvent.snapshot.balances.usdt.pendingDebit).toBe(5);
            expect(batchEvent.snapshot.updatedAt).toBe('2024-01-01T00:00:10.000Z');

            expect(getCounterValue(METRICS.walletUpdateCount, labels)).toBe(2);

            const histogramAfterBatch = getHistogramValues(METRICS.snapshotAgeSec, labels);

            expect(histogramAfterBatch).toHaveLength(2);
            expect(histogramAfterBatch[1]).toBeCloseTo(2);
        } finally {
            wallet?.off('update', handler);
            await hub.disconnect();
        }
    });
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

    simulateMessage(message: BitMexChannelMessage<'wallet'>): void {
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

function buildMessage(
    action: BitMexChannelMessage<'wallet'>['action'],
    data: BitMexWallet[],
): BitMexChannelMessage<'wallet'> {
    return {
        table: 'wallet',
        action,
        data,
    };
}

async function createConnectedHub(): Promise<{
    hub: ExchangeHub<'BitMex'>;
    socket: ControlledWebSocket;
}> {
    const hub = new ExchangeHub('BitMex', { isTest: true });
    const socket = ControlledWebSocket.instances[ControlledWebSocket.instances.length - 1];

    if (!socket) {
        throw new Error('ControlledWebSocket instance was not created');
    }

    const connectPromise = hub.connect();

    socket.simulateOpen();
    await connectPromise;

    return { hub, socket };
}
