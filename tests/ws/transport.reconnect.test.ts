import { WebSocketServer } from 'ws';

import type { AddressInfo } from 'node:net';
import type WebSocket from 'ws';
import { BitmexWsClient } from '../../src/core/bitmex/transport/ws';
import type { AuthError } from '../../src/infra/errors';
import { getCounterValue, resetMetrics } from '../../src/infra/metrics';

jest.setTimeout(15_000);

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
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

describe('BitmexWsClient reconnect auth flows', () => {
    let wss: WebSocketServer;
    let url: string;

    beforeEach(async () => {
        resetMetrics();
        wss = new WebSocketServer({ port: 0 });
        await new Promise<void>(resolve => wss.once('listening', resolve));

        const address = wss.address() as AddressInfo;

        url = `ws://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
        for (const client of wss.clients) {
            client.terminate();
        }

        await new Promise<void>(resolve => wss.close(() => resolve()));
    });

    test('automatic relogin retries with backoff after auth timeout', async () => {
        const attemptLog: Array<{ connection: number; count: number; time: number }> = [];
        let firstSocket: WebSocket | null = null;
        let connectionIndex = 0;

        wss.on('connection', socket => {
            connectionIndex += 1;

            const currentIndex = connectionIndex;

            if (currentIndex === 1) {
                firstSocket = socket;
            }

            let authCount = 0;

            socket.on('message', payload => {
                const message = JSON.parse(payload.toString()) as Record<string, unknown>;

                if (message.op !== 'authKeyExpires') {
                    return;
                }

                authCount += 1;
                attemptLog.push({ connection: currentIndex, count: authCount, time: Date.now() });

                if (currentIndex === 1) {
                    socket.send(JSON.stringify({ success: true, request: { op: 'authKeyExpires' } }));

                    return;
                }

                if (authCount === 1) {
                    // Do not respond to trigger timeout on the first reconnect attempt.
                    return;
                }

                socket.send(JSON.stringify({ success: true, request: { op: 'authKeyExpires' } }));
            });
        });

        const client = new BitmexWsClient({
            url,
            authTimeoutMs: 80,
            pingIntervalMs: 5_000,
            pongTimeoutMs: 5_000,
            reconnect: { baseDelayMs: 200, maxDelayMs: 200, maxAttempts: 5 },
        });

        const timeoutErrorPromise = new Promise<AuthError>(resolve => {
            client.on('auth_error', err => {
                if (err.code === 'TIMEOUT') {
                    resolve(err);
                }
            });
        });

        let authedCount = 0;
        const secondAuthedPromise = new Promise<void>(resolve => {
            client.on('authed', () => {
                authedCount += 1;

                if (authedCount === 2) {
                    resolve();
                }
            });
        });

        try {
            await client.connect();

            const firstResult = await client.login({
                apiKey: 'key',
                apiSecret: 'secret',
                now: () => 1_700_000_000_000,
            });

            expect(firstResult.ok).toBe(true);

            await waitFor(() => authedCount >= 1, 1_000);
            expect(firstSocket).not.toBeNull();
            firstSocket!.terminate();

            await timeoutErrorPromise;
            await secondAuthedPromise;

            const secondAttempts = attemptLog.filter(entry => entry.connection === 2);

            expect(secondAttempts).toHaveLength(2);

            const diff = secondAttempts[1].time - secondAttempts[0].time;

            expect(diff).toBeGreaterThanOrEqual(180);

            await delay(200);

            const finalSecondAttempts = attemptLog.filter(entry => entry.connection === 2);

            expect(finalSecondAttempts).toHaveLength(2);

            const labelsBase = { exchange: 'bitmex', env: 'mainnet', ws: 'realtime' } as const;

            expect(getCounterValue('auth_success_total', labelsBase)).toBe(2);

            const timeoutLabels = { ...labelsBase, reason: 'TIMEOUT' } as const;

            expect(getCounterValue('auth_error_total', timeoutLabels)).toBe(1);
        } finally {
            await client.disconnect();
        }
    });

    test('already authed response is treated as success without retries', async () => {
        let firstSocket: WebSocket | null = null;
        let connectionIndex = 0;
        const secondConnectionCounts: number[] = [];
        const authErrors: AuthError[] = [];

        wss.on('connection', socket => {
            connectionIndex += 1;

            const currentIndex = connectionIndex;

            if (currentIndex === 1) {
                firstSocket = socket;
            }

            let authCount = 0;

            socket.on('message', payload => {
                const message = JSON.parse(payload.toString()) as Record<string, unknown>;

                if (message.op !== 'authKeyExpires') {
                    return;
                }

                authCount += 1;

                if (currentIndex === 1) {
                    socket.send(JSON.stringify({ success: true, request: { op: 'authKeyExpires' } }));

                    return;
                }

                secondConnectionCounts.push(authCount);
                socket.send(
                    JSON.stringify({
                        success: false,
                        error: 'Already authenticated',
                        request: { op: 'authKeyExpires' },
                    }),
                );
            });
        });

        const client = new BitmexWsClient({
            url,
            authTimeoutMs: 200,
            pingIntervalMs: 5_000,
            pongTimeoutMs: 5_000,
            reconnect: { baseDelayMs: 200, maxDelayMs: 200, maxAttempts: 5 },
        });

        client.on('auth_error', err => {
            authErrors.push(err);
        });

        let authedCount = 0;
        const secondAuthedPromise = new Promise<void>(resolve => {
            client.on('authed', () => {
                authedCount += 1;

                if (authedCount === 2) {
                    resolve();
                }
            });
        });

        try {
            await client.connect();

            const firstResult = await client.login({
                apiKey: 'key',
                apiSecret: 'secret',
                now: () => 1_700_000_000_000,
            });

            expect(firstResult.ok).toBe(true);

            await waitFor(() => authedCount >= 1, 1_000);
            expect(firstSocket).not.toBeNull();
            firstSocket!.terminate();

            await secondAuthedPromise;

            expect(secondConnectionCounts).toEqual([1]);
            expect(authErrors).toHaveLength(0);

            const labelsBase = { exchange: 'bitmex', env: 'mainnet', ws: 'realtime' } as const;

            expect(getCounterValue('auth_success_total', labelsBase)).toBe(2);

            const alreadyLabels = { ...labelsBase, reason: 'ALREADY_AUTHED' } as const;

            expect(getCounterValue('auth_error_total', alreadyLabels)).toBe(0);
        } finally {
            await client.disconnect();
        }
    });

    test('private subscriptions wait for auth and resend after relogin', async () => {
        const subscribeEvents: Array<{ connection: number; authed: boolean; args: string[] }> = [];
        const sockets: WebSocket[] = [];
        let connectionIndex = 0;

        wss.on('connection', socket => {
            connectionIndex += 1;

            const currentIndex = connectionIndex;

            sockets.push(socket);

            let authed = false;

            socket.on('message', payload => {
                const message = JSON.parse(payload.toString()) as Record<string, unknown>;

                if (message.op === 'authKeyExpires') {
                    socket.send(JSON.stringify({ success: true, request: { op: 'authKeyExpires' } }));
                    authed = true;

                    return;
                }

                if (message.op === 'subscribe') {
                    const args = Array.isArray(message.args)
                        ? (message.args.filter((value): value is string => typeof value === 'string') as string[])
                        : [];

                    subscribeEvents.push({ connection: currentIndex, authed, args });
                }
            });
        });

        const client = new BitmexWsClient({
            url,
            authTimeoutMs: 200,
            pingIntervalMs: 5_000,
            pongTimeoutMs: 5_000,
            reconnect: { baseDelayMs: 200, maxDelayMs: 200, maxAttempts: 5 },
        });

        let authedCount = 0;
        const secondAuthedPromise = new Promise<void>(resolve => {
            client.on('authed', () => {
                authedCount += 1;

                if (authedCount === 2) {
                    resolve();
                }
            });
        });

        try {
            await client.connect();

            client.send(JSON.stringify({ op: 'subscribe', args: ['position'] }));

            await delay(50);
            expect(subscribeEvents).toHaveLength(0);

            const firstAuthedPromise = new Promise<void>(resolve => client.once('authed', () => resolve()));
            const loginResult = await client.login({
                apiKey: 'key',
                apiSecret: 'secret',
                now: () => 1_700_000_000_000,
            });

            expect(loginResult.ok).toBe(true);
            await firstAuthedPromise;

            await waitFor(() => subscribeEvents.length >= 1, 1_000);
            expect(subscribeEvents[0]).toEqual({ connection: 1, authed: true, args: ['position'] });

            expect(sockets[0]).toBeDefined();
            sockets[0].terminate();

            await secondAuthedPromise;

            await waitFor(() => subscribeEvents.length >= 2, 1_000);
            expect(subscribeEvents[1]).toEqual({ connection: 2, authed: true, args: ['position'] });
        } finally {
            await client.disconnect();
        }
    });
});
