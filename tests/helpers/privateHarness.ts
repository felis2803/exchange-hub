import { ScenarioServer } from './ws-mock/server';
import { createTestClock, type TestClock, type TestClockOptions } from './clock';

import { ExchangeHub } from '../../src/ExchangeHub';
import { channelMessageHandlers } from '../../src/core/bitmex/channelMessageHandlers/index';
import { markOrderChannelAwaitingSnapshot } from '../../src/core/bitmex/channels/order';
import { markPositionsAwaitingResync } from '../../src/core/bitmex/channels/position';
import type { BitMex } from '../../src/core/bitmex/index';
import { BitmexWsClient } from '../../src/core/bitmex/transport/ws';
import { isChannelMessage, isSubscribeMessage } from '../../src/core/bitmex/utils';
import { resetMetrics } from '../../src/infra/metrics';
import type { BitMexChannel, BitMexChannelMessage } from '../../src/core/bitmex/types';
import type { ScenarioScript } from './ws-mock/scenario';
import { noop as noopFn } from '../../src/utils/noop';

export type PrivateHarnessOptions = TestClockOptions;

export interface PrivateHarness {
    clock: TestClock;
    hub: ExchangeHub<'BitMex'>;
    core: BitMex;
    client: BitmexWsClient;
    server: ScenarioServer;
    cleanup(): Promise<void>;
}

export async function setupPrivateHarness(
    scenario: ScenarioScript,
    options: PrivateHarnessOptions = {},
): Promise<PrivateHarness> {
    resetMetrics();

    const clock = createTestClock(options);
    const server = new ScenarioServer(scenario, { clock });

    await server.start();

    const noop = createNoopWebSocket();
    const hub = new ExchangeHub('BitMex', { isTest: true, apiKey: 'key', apiSec: 'secret' });
    const core = hub.Core as BitMex;

    const client = new BitmexWsClient({
        url: server.url,
        authTimeoutMs: 5_000,
        pingIntervalMs: 60_000,
        pongTimeoutMs: 60_000,
        reconnect: { baseDelayMs: 50, maxDelayMs: 200, maxAttempts: 5 },
    });

    client.on('message', raw => {
        handleIncoming(core, raw);
    });

    await client.connect();

    const login = await client.login({
        apiKey: 'key',
        apiSecret: 'secret',
        now: () => Math.floor(clock.now()),
    });

    if (!login.ok) {
        throw login.err;
    }

    client.send(JSON.stringify({ op: 'subscribe', args: ['wallet', 'position', 'order'] }));

    return {
        clock,
        hub,
        core,
        client,
        server,
        cleanup: async () => {
            try {
                await client.disconnect({ graceful: true });
            } catch {
                // ignore
            }

            await server.stop();
            noop.restore();
            clock.useRealTimers();
        },
    };
}

function handleIncoming(core: BitMex, raw: string): void {
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return;
    }

    if (isChannelMessage(parsed)) {
        const message = parsed as BitMexChannelMessage<BitMexChannel>;

        channelMessageHandlers[message.table][message.action](core, message.data);

        return;
    }

    if (isSubscribeMessage(parsed) && parsed.success) {
        const args = new Set(parsed.request?.args ?? []);

        if (parsed.subscribe === 'order' || args.has('order')) {
            markOrderChannelAwaitingSnapshot(core);
        }

        if (parsed.subscribe === 'position' || args.has('position')) {
            markPositionsAwaitingResync(core);
        }
    }
}

function createNoopWebSocket(): {
    restore(): void;
} {
    const OriginalWebSocket = (globalThis as any).WebSocket;

    class NoopSocket {
        #url: string;
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
        onerror: ((err: unknown) => void) | null = null;

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
            noopFn(data);
        }

        close(): void {
            this.#emit('close', { code: 1000, reason: 'noop' });
        }

        #emit(event: string, payload?: unknown): void {
            const handler = (this as any)[`on${event}`];

            if (typeof handler === 'function') {
                handler(payload);
            }

            for (const listener of this.#listeners.get(event) ?? []) {
                listener(payload);
            }
        }
    }

    (globalThis as any).WebSocket = NoopSocket as unknown as typeof OriginalWebSocket;

    return {
        restore() {
            (globalThis as any).WebSocket = OriginalWebSocket;
        },
    };
}
