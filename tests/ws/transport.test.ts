import type { AddressInfo } from 'node:net';

import { WebSocketServer } from 'ws';

import { BitmexWsClient } from '../../src/cores/bitmex/transport/ws.js';
import { ValidationError } from '../../src/infra/errors.js';

jest.setTimeout(10_000);

class TestBitmexWsClient extends BitmexWsClient {
  public readonly openCalls: ('connecting' | 'reconnecting')[] = [];

  protected override openSocket(state: 'connecting' | 'reconnecting'): void {
    this.openCalls.push(state);

    if (state === 'connecting') {
      super.openSocket(state);
      return;
    }

    this.clearReconnectTimer();
  }

  public triggerPongTimeout(): void {
    this.handlePongTimeout();
  }
}

describe('BitmexWsClient (transport)', () => {
  let wss: WebSocketServer;
  let url: string;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    const address = wss.address() as AddressInfo;
    url = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of wss.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  test('queues messages until open and flushes them on connect', async () => {
    const received: string[] = [];
    const messagePromise = new Promise<void>((resolve) => {
      wss.once('connection', (socket) => {
        socket.on('message', (payload) => {
          received.push(payload.toString());
          if (received.length === 2) {
            resolve();
          }
        });
      });
    });

    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      reconnect: { baseDelayMs: 50, maxDelayMs: 50, maxAttempts: 3 },
    });

    const openPromise = new Promise<void>((resolve) => client.once('open', resolve));

    client.send('first');
    client.send('second');

    await client.connect();
    await openPromise;
    await messagePromise;

    expect(received).toEqual(['first', 'second']);
    expect(client.isOpen()).toBe(true);

    await client.disconnect();
  });

  test('throws ValidationError when send buffer exceeds limit', () => {
    const client = new BitmexWsClient({ url, sendBufferLimit: 2 });

    client.send('one');
    client.send('two');

    expect(() => client.send('three')).toThrow(ValidationError);
  });

  test('reconnects after abnormal close and resets attempt counter', async () => {
    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 200,
      pongTimeoutMs: 200,
      reconnect: { baseDelayMs: 50, maxDelayMs: 50, maxAttempts: 5 },
    });

    client.on('error', () => {});

    let openCount = 0;
    const secondOpen = new Promise<void>((resolve) => {
      client.on('open', () => {
        openCount += 1;
        if (openCount === 2) {
          resolve();
        }
      });
    });

    wss.on('connection', (socket) => {
      if (openCount === 0) {
        setTimeout(() => socket.terminate(), 20);
      }
    });

    await client.connect();
    await secondOpen;

    expect(client.getState()).toBe('open');
    expect((client as any).reconnectAttempts).toBe(0);

    await client.disconnect();
  });

  test('computes exponential backoff with cap', () => {
    const client = new BitmexWsClient({
      url,
      reconnect: { baseDelayMs: 200, maxDelayMs: 1_000, maxAttempts: 12 },
    });

    const delays = Array.from(
      { length: 6 },
      (_, idx) => (client as any).computeReconnectDelay(idx + 1) as number,
    );

    expect(delays).toEqual([200, 400, 800, 1_000, 1_000, 1_000]);
  });

  test('triggers reconnect on pong timeout', async () => {
    const client = new TestBitmexWsClient({
      url,
      pingIntervalMs: 40,
      pongTimeoutMs: 60,
      reconnect: { baseDelayMs: 25, maxDelayMs: 25, maxAttempts: 4 },
    });

    client.on('error', () => {});

    await client.connect();

    const closeInfoPromise = new Promise<{ code: number; reason?: string }>((resolve) =>
      client.once('close', resolve),
    );

    client.triggerPongTimeout();

    const closeInfo = await closeInfoPromise;

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(closeInfo.code).toBe(1006);
    expect(client.openCalls).toContain('reconnecting');
    expect(client.getState()).toBe('reconnecting');

    await client.disconnect();
  });

  test('does not reconnect after manual disconnect', async () => {
    const client = new TestBitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      reconnect: { baseDelayMs: 25, maxDelayMs: 25, maxAttempts: 3 },
    });

    client.on('error', () => {});

    await client.connect();

    expect(client.getState()).toBe('open');
    expect(client.openCalls).toEqual(['connecting']);

    await client.disconnect();

    expect(client.getState()).toBe('idle');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(client.openCalls).toEqual(['connecting']);
    expect((client as any).reconnectTimer).toBeNull();
  });

  test('does not reconnect after normal server close', async () => {
    const client = new TestBitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      reconnect: { baseDelayMs: 25, maxDelayMs: 25, maxAttempts: 3 },
    });

    client.on('error', () => {});

    wss.once('connection', (socket) => {
      setTimeout(() => socket.close(1000, 'server-close'), 20);
    });

    await client.connect();

    const closeInfo = await new Promise<{ code: number; reason?: string }>((resolve) =>
      client.once('close', resolve),
    );

    expect(closeInfo.code).toBe(1000);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(client.getState()).toBe('idle');
    expect(client.openCalls).toEqual(['connecting']);
    expect((client as any).reconnectTimer).toBeNull();

    await client.disconnect();
  });

  test('pong extends deadline on pong event', async () => {
    jest.useFakeTimers();

    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 1_000_000,
      pongTimeoutMs: 200,
      reconnect: { baseDelayMs: 25, maxDelayMs: 25, maxAttempts: 3 },
    });

    client.on('error', () => {});

    try {
      await client.connect();

      const timeoutSpy = jest.spyOn(client as any, 'handlePongTimeout');

      try {
        expect((client as any).pongTimer).not.toBeNull();

        jest.advanceTimersByTime(150);
        expect(timeoutSpy).not.toHaveBeenCalled();

        (client as any).handlePong();

        jest.advanceTimersByTime(60);
        expect(timeoutSpy).not.toHaveBeenCalled();
      } finally {
        timeoutSpy.mockRestore();
      }
    } finally {
      jest.useRealTimers();
      await client.disconnect();
    }
  });
});
