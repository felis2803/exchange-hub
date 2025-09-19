import { ExchangeHub } from '../../src/ExchangeHub.js';
import { channelMessageHandlers } from '../../src/core/bitmex/channelMessageHandlers/index.js';
import { markOrderChannelAwaitingSnapshot } from '../../src/core/bitmex/channels/order.js';
import { markPositionsAwaitingResync } from '../../src/core/bitmex/channels/position.js';
import type { BitMex } from '../../src/core/bitmex/index.js';
import { BitmexWsClient } from '../../src/core/bitmex/transport/ws.js';
import { isChannelMessage, isSubscribeMessage } from '../../src/core/bitmex/utils.js';
import { resetMetrics } from '../../src/infra/metrics.js';

import type { BitMexChannel, BitMexChannelMessage } from '../../src/core/bitmex/types.js';

import type { ScenarioScript } from './ws-mock/scenario.js';
import { ScenarioServer } from './ws-mock/server.js';
import { createTestClock, type TestClock, type TestClockOptions } from './clock.js';

export interface PrivateHarnessOptions extends TestClockOptions {}

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

  client.on('message', (raw) => {
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
    public readonly url: string;
    public onopen: (() => void) | null = null;
    public onmessage: ((event: { data: unknown }) => void) | null = null;
    public onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
    public onerror: ((err: unknown) => void) | null = null;

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

