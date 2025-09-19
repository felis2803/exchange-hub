import type { AddressInfo } from 'node:net';

import { WebSocketServer } from 'ws';

import { BitmexWsClient } from '../../src/core/bitmex/transport/ws.js';

jest.setTimeout(10_000);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Condition timed out');
    }
    await delay(10);
  }
}

describe('BitmexWsClient private message buffering', () => {
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

  test('private subscribe messages stay buffered until authed', async () => {
    const fakeNow = 1_700_000_000_000;
    const receivedOps: string[] = [];
    const privateMessages: Array<{ args: string[] }> = [];

    wss.on('connection', (socket) => {
      socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString()) as Record<string, unknown>;
        const op = typeof message.op === 'string' ? message.op : '';
        receivedOps.push(op);

        if (op === 'authKeyExpires') {
          socket.send(JSON.stringify({ success: true, request: { op: 'authKeyExpires' } }));
          return;
        }

        if (op === 'subscribe') {
          const args = Array.isArray(message.args)
            ? message.args.filter((value): value is string => typeof value === 'string')
            : [];
          privateMessages.push({ args });
        }
      });
    });

    const client = new BitmexWsClient({
      url,
      authTimeoutMs: 200,
      pingIntervalMs: 5_000,
      pongTimeoutMs: 5_000,
    });

    const authed = new Promise<void>((resolve) => client.once('authed', () => resolve()));

    try {
      await client.connect();

      client.send(JSON.stringify({ op: 'subscribe', args: ['position'] }));
      client.send(JSON.stringify({ op: 'subscribe', args: ['wallet'] }));

      await delay(50);
      expect(privateMessages).toHaveLength(0);
      expect(receivedOps).not.toContain('subscribe');

      const loginResult = await client.login({
        apiKey: 'key',
        apiSecret: 'secret',
        now: () => fakeNow,
      });
      expect(loginResult.ok).toBe(true);

      await authed;
      await waitFor(() => privateMessages.length === 2, 1_000);

      expect(receivedOps[0]).toBe('authKeyExpires');
      expect(privateMessages.map((entry) => entry.args)).toEqual([['position'], ['wallet']]);

      await delay(50);
      expect(privateMessages).toHaveLength(2);
    } finally {
      await client.disconnect();
    }
  });
});
