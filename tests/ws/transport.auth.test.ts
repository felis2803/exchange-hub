import { createHmac } from 'node:crypto';

import { WebSocketServer } from 'ws';

import type { AddressInfo } from 'node:net';
import { BitmexWsClient } from '../../src/core/bitmex/transport/ws.js';
import { AuthError } from '../../src/infra/errors.js';
import { getCounterValue, getHistogramValues, resetMetrics } from '../../src/infra/metrics.js';

jest.setTimeout(10_000);

describe('BitmexWsClient auth flows', () => {
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

    test('auth success emits authed and records metrics', async () => {
        const fakeNow = 1_700_000_000_000;
        const apiKey = 'test-key';
        const apiSecret = 'test-secret';
        const received: Record<string, unknown>[] = [];

        wss.on('connection', socket => {
            socket.on('message', payload => {
                const message = JSON.parse(payload.toString()) as Record<string, unknown>;

                received.push(message);

                if (message.op === 'authKeyExpires') {
                    const args = Array.isArray(message.args) ? message.args : [];
                    const expires = Number(args[1]);
                    const signature = typeof args[2] === 'string' ? (args[2] as string) : '';

                    expect(typeof args[0]).toBe('string');
                    expect(Number.isInteger(expires)).toBe(true);

                    const expectedExpires = Math.floor(fakeNow / 1000) + 60;

                    expect(expires).toBe(expectedExpires);

                    const expectedSignature = createHmac('sha256', apiSecret)
                        .update('GET/realtime' + String(expires))
                        .digest('hex');

                    expect(signature).toBe(expectedSignature);

                    socket.send(JSON.stringify({ success: true, request: { op: 'authKeyExpires' } }));
                }
            });
        });

        const client = new BitmexWsClient({
            url,
            authTimeoutMs: 500,
            pingIntervalMs: 5_000,
            pongTimeoutMs: 5_000,
        });

        const authed = new Promise<{ ts: number }>(resolve => client.once('authed', resolve));

        try {
            await client.connect();

            const result = await client.login({ apiKey, apiSecret, now: () => fakeNow });

            expect(result.ok).toBe(true);

            const authedInfo = await authed;

            expect(typeof authedInfo.ts).toBe('number');
            expect(received).toHaveLength(1);

            const successLabels = { exchange: 'bitmex', env: 'mainnet', ws: 'realtime' } as const;

            expect(getCounterValue('auth_success_total', successLabels)).toBe(1);

            const latency = getHistogramValues('auth_latency_ms', successLabels);

            expect(latency).toHaveLength(1);
            expect(latency[0]).toBeGreaterThanOrEqual(0);
        } finally {
            await client.disconnect();
        }
    });

    test('invalid signature maps to BAD_CREDENTIALS error', async () => {
        wss.on('connection', socket => {
            socket.on('message', payload => {
                const message = JSON.parse(payload.toString()) as Record<string, unknown>;

                if (message.op === 'authKeyExpires') {
                    socket.send(
                        JSON.stringify({
                            success: false,
                            error: 'Signature not valid',
                            request: { op: 'authKeyExpires' },
                        }),
                    );
                }
            });
        });

        const client = new BitmexWsClient({
            url,
            authTimeoutMs: 200,
            pingIntervalMs: 5_000,
            pongTimeoutMs: 5_000,
        });

        const authErrorEvent = new Promise<AuthError>(resolve => client.once('auth_error', resolve));

        try {
            await client.connect();

            const result = await client.login({
                apiKey: 'bad-key',
                apiSecret: 'bad-secret',
                now: () => 1_700_000_000_000,
            });

            expect(result.ok).toBe(false);
            expect(result.err).toBeInstanceOf(AuthError);
            expect(result.err.code).toBe('BAD_CREDENTIALS');

            const emitted = await authErrorEvent;

            expect(emitted.code).toBe('BAD_CREDENTIALS');

            const successLabels = { exchange: 'bitmex', env: 'mainnet', ws: 'realtime' } as const;

            expect(getCounterValue('auth_success_total', successLabels)).toBe(0);

            const errorLabels = { ...successLabels, reason: 'BAD_CREDENTIALS' } as const;

            expect(getCounterValue('auth_error_total', errorLabels)).toBe(1);
        } finally {
            await client.disconnect();
        }
    });

    test('clock skew error resolved by increasing expires skew', async () => {
        const fakeNow = 1_700_000_000_000;
        const expiryThreshold = Math.floor(fakeNow / 1000) + 120;

        wss.on('connection', socket => {
            socket.on('message', payload => {
                const message = JSON.parse(payload.toString()) as Record<string, unknown>;

                if (message.op !== 'authKeyExpires') {
                    return;
                }

                const args = Array.isArray(message.args) ? message.args : [];
                const expires = Number(args[1]);

                if (Number.isFinite(expires) && expires < expiryThreshold) {
                    socket.send(
                        JSON.stringify({
                            success: false,
                            error: 'Request has expired',
                            request: { op: 'authKeyExpires' },
                        }),
                    );

                    return;
                }

                socket.send(JSON.stringify({ success: true, request: { op: 'authKeyExpires' } }));
            });
        });

        const lowSkewClient = new BitmexWsClient({ url, authTimeoutMs: 200, authExpiresSkewSec: 10 });
        const lowSkewError = new Promise<AuthError>(resolve => lowSkewClient.once('auth_error', resolve));

        try {
            await lowSkewClient.connect();

            const result = await lowSkewClient.login({
                apiKey: 'key',
                apiSecret: 'secret',
                now: () => fakeNow,
            });

            expect(result.ok).toBe(false);
            expect(result.err.code).toBe('CLOCK_SKEW');

            const emitted = await lowSkewError;

            expect(emitted.code).toBe('CLOCK_SKEW');

            const errorLabels = {
                exchange: 'bitmex',
                env: 'mainnet',
                ws: 'realtime',
                reason: 'CLOCK_SKEW',
            } as const;

            expect(getCounterValue('auth_error_total', errorLabels)).toBe(1);
        } finally {
            await lowSkewClient.disconnect();
        }

        const highSkewClient = new BitmexWsClient({ url, authTimeoutMs: 200, authExpiresSkewSec: 200 });
        const highSkewAuthed = new Promise<{ ts: number }>(resolve => highSkewClient.once('authed', resolve));

        try {
            await highSkewClient.connect();

            const result = await highSkewClient.login({
                apiKey: 'key',
                apiSecret: 'secret',
                now: () => fakeNow,
            });

            expect(result.ok).toBe(true);

            await highSkewAuthed;

            const successLabels = { exchange: 'bitmex', env: 'mainnet', ws: 'realtime' } as const;

            expect(getCounterValue('auth_success_total', successLabels)).toBe(1);
        } finally {
            await highSkewClient.disconnect();
        }
    });
});
