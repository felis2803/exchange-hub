import type { AddressInfo } from 'node:net';

import { WebSocketServer } from 'ws';

import { BitmexWsClient } from '../../src/cores/bitmex/transport/ws.js';
import {
  AuthBadCredentialsError,
  AuthClockSkewError,
  AuthTimeoutError,
  NetworkError,
  ValidationError,
} from '../../src/infra/errors.js';
import { getCounterValue, getHistogramValues, resetMetrics } from '../../src/infra/metrics.js';

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
    resetMetrics();
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

    try {
      await client.connect();
      await openPromise;
      await messagePromise;

      expect(received).toEqual(['first', 'second']);
      expect(client.isOpen()).toBe(true);
    } finally {
      await client.disconnect();
    }
  });

  test('throws ValidationError when send buffer exceeds limit', () => {
    const client = new BitmexWsClient({ url, sendBufferLimit: 2 });

    client.send('one');
    client.send('two');

    expect(() => client.send('three')).toThrow(ValidationError);
  });

  test('performs login handshake and emits authed', async () => {
    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      authTimeoutMs: 500,
    });

    const authed = new Promise<{ ts: number }>((resolve) => client.once('authed', resolve));

    wss.on('connection', (socket) => {
      socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString());
        if (message.op === 'authKeyExpires') {
          socket.send(
            JSON.stringify({
              success: true,
              request: { op: 'authKeyExpires', id: 'req-1' },
            }),
          );
        }
      });
    });

    try {
      await client.connect();
      await expect(client.login('test-key', 'test-secret')).resolves.toBeUndefined();

      const authedInfo = await authed;
      expect(typeof authedInfo.ts).toBe('number');
      expect(getCounterValue('auth_success_total', { source: 'manual' })).toBe(1);

      const latency = getHistogramValues('auth_latency_ms', { source: 'manual' });
      expect(latency.length).toBe(1);
      expect(latency[0]).toBeGreaterThanOrEqual(0);
    } finally {
      await client.disconnect();
    }
  });

  test('throws NetworkError when login is called without an open socket', async () => {
    const client = new BitmexWsClient({ url });

    try {
      await expect(client.login('key', 'secret')).rejects.toBeInstanceOf(NetworkError);
    } finally {
      await client.disconnect();
    }
  });

  test('maps bad credentials auth error', async () => {
    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      authTimeoutMs: 500,
    });

    const authError = new Promise<Error>((resolve) => client.once('auth_error', resolve));

    wss.on('connection', (socket) => {
      socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString());
        if (message.op === 'authKeyExpires') {
          socket.send(
            JSON.stringify({
              success: false,
              error: 'Signature not valid',
              request: { op: 'authKeyExpires', id: 'req-err' },
            }),
          );
        }
      });
    });

    try {
      await client.connect();

      await expect(client.login('bad-key', 'bad-secret')).rejects.toBeInstanceOf(
        AuthBadCredentialsError,
      );

      const emitted = await authError;
      expect(emitted).toBeInstanceOf(AuthBadCredentialsError);
      expect(getCounterValue('auth_success_total', { source: 'manual' })).toBe(0);
    } finally {
      await client.disconnect();
    }
  });

  test('maps clock skew auth error', async () => {
    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      authTimeoutMs: 500,
    });

    const authError = new Promise<Error>((resolve) => client.once('auth_error', resolve));

    wss.on('connection', (socket) => {
      socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString());
        if (message.op === 'authKeyExpires') {
          socket.send(
            JSON.stringify({
              success: false,
              error: 'Timestamp is too far in the future',
              request: { op: 'authKeyExpires', id: 'req-clock' },
            }),
          );
        }
      });
    });

    try {
      await client.connect();

      await expect(client.login('key', 'secret')).rejects.toBeInstanceOf(AuthClockSkewError);

      const emitted = await authError;
      expect(emitted).toBeInstanceOf(AuthClockSkewError);
    } finally {
      await client.disconnect();
    }
  });

  test('rejects login on timeout', async () => {
    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      authTimeoutMs: 50,
    });

    const authError = new Promise<Error>((resolve) => client.once('auth_error', resolve));

    wss.on('connection', (socket) => {
      socket.on('message', () => {
        // Intentionally ignore to trigger timeout.
      });
    });

    try {
      await client.connect();

      await expect(client.login('key', 'secret')).rejects.toBeInstanceOf(AuthTimeoutError);

      const emitted = await authError;
      expect(emitted).toBeInstanceOf(AuthTimeoutError);

      expect(getCounterValue('auth_success_total', { source: 'manual' })).toBe(0);
    } finally {
      await client.disconnect();
    }
  });

  test('automatically relogins after reconnect', async () => {
    const client = new BitmexWsClient({
      url,
      pingIntervalMs: 200,
      pongTimeoutMs: 500,
      authTimeoutMs: 500,
      reconnect: { baseDelayMs: 25, maxDelayMs: 25, maxAttempts: 5 },
    });

    client.on('error', () => {});

    const authErrors: Error[] = [];
    client.on('auth_error', (err) => authErrors.push(err));

    const authRequests: number[] = [];
    const authedTimestamps: number[] = [];

    const authedTwice = new Promise<void>((resolve) => {
      client.on('authed', ({ ts }) => {
        authedTimestamps.push(ts);
        if (authedTimestamps.length === 2) {
          resolve();
        }
      });
    });

    let connectionCount = 0;
    wss.on('connection', (socket) => {
      connectionCount += 1;
      socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString());
        if (message.op === 'authKeyExpires') {
          authRequests.push(connectionCount);
          socket.send(
            JSON.stringify({
              success: true,
              request: { op: 'authKeyExpires', id: `req-${connectionCount}` },
            }),
          );

          if (connectionCount === 1) {
            setTimeout(() => socket.terminate(), 20);
          }
        }
      });
    });

    try {
      await client.connect();
      await expect(client.login('key', 'secret')).resolves.toBeUndefined();

      await authedTwice;

      expect(authedTimestamps).toHaveLength(2);
      expect(connectionCount).toBe(2);
      expect(authRequests).toEqual([1, 2]);
      expect(authErrors).toHaveLength(0);
      expect(getCounterValue('auth_success_total', { source: 'manual' })).toBe(1);
      expect(getCounterValue('auth_success_total', { source: 'reconnect' })).toBe(1);

      const reconnectLatency = getHistogramValues('auth_latency_ms', { source: 'reconnect' });
      expect(reconnectLatency.length).toBe(1);
      expect(reconnectLatency[0]).toBeGreaterThanOrEqual(0);
      expect(client.getState()).toBe('open');
    } finally {
      await client.disconnect();
    }
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

    try {
      await client.connect();
      await secondOpen;

      expect(client.getState()).toBe('open');
      expect((client as any).reconnectAttempts).toBe(0);
    } finally {
      await client.disconnect();
    }
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

    try {
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
    } finally {
      await client.disconnect();
    }
  });

  test('does not reconnect after manual disconnect', async () => {
    const client = new TestBitmexWsClient({
      url,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
      reconnect: { baseDelayMs: 25, maxDelayMs: 25, maxAttempts: 3 },
    });

    client.on('error', () => {});

    try {
      await client.connect();

      expect(client.getState()).toBe('open');
      expect(client.openCalls).toEqual(['connecting']);

      await client.disconnect();

      expect(client.getState()).toBe('idle');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(client.openCalls).toEqual(['connecting']);
      expect((client as any).reconnectTimer).toBeNull();
    } finally {
      await client.disconnect();
    }
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

    try {
      await client.connect();

      const closeInfo = await new Promise<{ code: number; reason?: string }>((resolve) =>
        client.once('close', resolve),
      );

      expect(closeInfo.code).toBe(1000);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(client.getState()).toBe('idle');
      expect(client.openCalls).toEqual(['connecting']);
      expect((client as any).reconnectTimer).toBeNull();
    } finally {
      await client.disconnect();
    }
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
