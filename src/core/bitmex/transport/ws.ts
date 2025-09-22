import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import WebSocket from 'ws';

import { createLogger } from '../../../infra/logger';
import { AuthError, ValidationError, fromWsClose } from '../../../infra/errors';
import { incrementCounter, observeHistogram } from '../../../infra/metrics';
import { getAuthExpiresSkewSec, getBitmexCredentials } from '../../../config/bitmex';
import {
    BITMEX_PRIVATE_CHANNELS,
    BITMEX_WS_ENDPOINTS,
    WS_PING_INTERVAL_MS,
    WS_PONG_TIMEOUT_MS,
    WS_RECONNECT_BASE_DELAY_MS,
    WS_RECONNECT_MAX_ATTEMPTS,
    WS_RECONNECT_MAX_DELAY_MS,
    WS_SEND_BUFFER_LIMIT,
} from '../constants';
import type { RawData } from 'ws';
import type { Logger } from '../../../infra/logger';
import type { BitmexCredentials } from '../../../config/bitmex';

const AUTH_SUCCESS_COUNTER = 'auth_success_total';
const AUTH_ERROR_COUNTER = 'auth_error_total';
const AUTH_LATENCY_HISTOGRAM = 'auth_latency_ms';

const BAD_CREDENTIAL_PATTERNS = [
    'signature not valid',
    'invalid signature',
    'signature verification',
    'invalid api key',
    'invalid api key id',
    'invalid api secret',
    'auth denied',
    'permission denied',
    'insufficient permission',
    'not authorized',
    'unauthorized',
    'access denied',
    'bad credentials',
    'forbidden',
] as const;

const CLOCK_SKEW_PATTERNS = [
    'timestamp',
    'request has expired',
    'expired',
    'too far in the future',
    'too far in the past',
    'clock skew',
    'time difference',
    'system clock',
] as const;

const ALREADY_AUTHED_PATTERNS = ['already authenticated', 'already authed'] as const;

const PRIVATE_CHANNEL_PREFIXES = new Set<string>(BITMEX_PRIVATE_CHANNELS);

export type WsState = 'idle' | 'connecting' | 'open' | 'closing' | 'reconnecting';

export interface BitmexWsOptions {
    isTest?: boolean;
    url?: string;
    pingIntervalMs?: number;
    pongTimeoutMs?: number;
    authTimeoutMs?: number;
    authExpiresSkewSec?: number;
    reconnect?: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
    };
    sendBufferLimit?: number;
}

export interface BitmexWsEvents {
    open: () => void;
    close: (info: { code: number; reason?: string }) => void;
    error: (err: Error) => void;
    message: (raw: string) => void;
    authed: (info: { ts: number }) => void;
    auth_error: (err: AuthError) => void;
}

export interface LoginParams {
    apiKey?: string;
    apiSecret?: string;
    now?: () => number;
}

export type LoginResult = { ok: true; ts: number } | { ok: false; err: AuthError };

type TimerHandle = ReturnType<typeof setTimeout>;

interface NormalizedReconnectOptions {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

type AuthAttemptSource = 'manual' | 'reconnect';

interface PendingAuth {
    requestId: string;
    startedAt: number;
    timeout: TimerHandle;
    resolve: (result: LoginResult) => void;
    source: AuthAttemptSource;
}

interface PendingMessage {
    raw: string;
    requiresAuth: boolean;
}

export class BitmexWsClient extends EventEmitter {
    #url: string;
    #pingIntervalMs: number;
    #pongTimeoutMs: number;
    #sendBufferLimit: number;
    #reconnectOptions: NormalizedReconnectOptions;
    #authTimeoutMs: number;
    #authExpiresSkewSec: number;
    #envLabel: 'testnet' | 'mainnet';

    #ws: WebSocket | null = null;
    #state: WsState = 'idle';
    #sendBuffer: PendingMessage[] = [];
    #pendingPrivateMessages = new Set<string>();
    #privateSubscriptions = new Set<string>();
    #reconnectAttempts = 0;
    #manualClose = false;
    #credentials: BitmexCredentials | null = null;
    #shouldRelogin = false;
    #isAuthed = false;
    #pendingAuth: PendingAuth | null = null;
    #authRetryAttempts = 0;
    #authRetryTimer: TimerHandle | null = null;

    #pingTimer: TimerHandle | null = null;
    #pongTimer: TimerHandle | null = null;
    #reconnectTimer: TimerHandle | null = null;

    #connectPromise: Promise<void> | null = null;
    #resolveConnect: (() => void) | undefined;
    #rejectConnect: ((err: Error) => void) | undefined;

    #log = createLogger('bitmex:ws');
    #authLog = this.#log.withTags(['auth', 'ws']);
    #authReconnectLog = this.#authLog.withTags(['reconnect']);

    override on<Event extends keyof BitmexWsEvents>(event: Event, listener: BitmexWsEvents[Event]): this;

    override on(event: string | symbol, listener: (...args: unknown[]) => void): this;

    override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }

    override once<Event extends keyof BitmexWsEvents>(event: Event, listener: BitmexWsEvents[Event]): this;

    override once(event: string | symbol, listener: (...args: unknown[]) => void): this;

    override once(event: string | symbol, listener: (...args: unknown[]) => void): this {
        return super.once(event, listener);
    }

    override off<Event extends keyof BitmexWsEvents>(event: Event, listener: BitmexWsEvents[Event]): this;

    override off(event: string | symbol, listener: (...args: unknown[]) => void): this;

    override off(event: string | symbol, listener: (...args: unknown[]) => void): this {
        return super.off(event, listener);
    }

    override emit<Event extends keyof BitmexWsEvents>(
        event: Event,
        ...args: Parameters<BitmexWsEvents[Event]>
    ): boolean;

    override emit(event: string | symbol, ...args: unknown[]): boolean;

    override emit(event: string | symbol, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }

    constructor(opts: BitmexWsOptions = {}) {
        super();

        const {
            isTest,
            url,
            pingIntervalMs = WS_PING_INTERVAL_MS,
            pongTimeoutMs = WS_PONG_TIMEOUT_MS,
            authTimeoutMs,
            authExpiresSkewSec,
            reconnect,
            sendBufferLimit = WS_SEND_BUFFER_LIMIT,
        } = opts;

        const {
            baseDelayMs = WS_RECONNECT_BASE_DELAY_MS,
            maxDelayMs = WS_RECONNECT_MAX_DELAY_MS,
            maxAttempts = WS_RECONNECT_MAX_ATTEMPTS,
        } = reconnect ?? {};

        const normalizedAuthTimeout =
            typeof authTimeoutMs === 'number' && Number.isFinite(authTimeoutMs) && authTimeoutMs > 0
                ? Math.max(1, Math.trunc(authTimeoutMs))
                : 1_000;
        const envAuthSkew = getAuthExpiresSkewSec();
        const normalizedAuthExpiresSkew =
            typeof authExpiresSkewSec === 'number' && Number.isFinite(authExpiresSkewSec) && authExpiresSkewSec > 0
                ? Math.max(1, Math.trunc(authExpiresSkewSec))
                : envAuthSkew;

        const envLabel = isTest ? 'testnet' : 'mainnet';

        this.#url = url ?? (isTest ? BITMEX_WS_ENDPOINTS.testnet : BITMEX_WS_ENDPOINTS.mainnet);
        this.#pingIntervalMs = pingIntervalMs;
        this.#pongTimeoutMs = pongTimeoutMs;
        this.#sendBufferLimit = sendBufferLimit;
        this.#reconnectOptions = {
            baseDelayMs,
            maxDelayMs,
            maxAttempts,
        } satisfies NormalizedReconnectOptions;
        this.#authTimeoutMs = normalizedAuthTimeout;
        this.#authExpiresSkewSec = normalizedAuthExpiresSkew;
        this.#envLabel = envLabel;
    }

    getState(): WsState {
        return this.#state;
    }

    isOpen(): boolean {
        return this.#ws?.readyState === WebSocket.OPEN;
    }

    async connect(): Promise<void> {
        this.#manualClose = false;

        if (this.isOpen()) {
            this.#log.info('BitMEX WS already open', { url: this.#url });

            return;
        }

        if (!this.#connectPromise) {
            this.#connectPromise = new Promise<void>((resolve, reject) => {
                this.#resolveConnect = resolve;
                this.#rejectConnect = reject;
            });
        }

        if (this.#state === 'connecting' || this.#state === 'reconnecting') {
            return this.#connectPromise;
        }

        this.#reconnectAttempts = 0;
        this.#openSocket('connecting');

        return this.#connectPromise;
    }

    async login(params: LoginParams = {}): Promise<LoginResult> {
        const { apiKey, apiSecret, now } = params;

        let credentials: BitmexCredentials;

        try {
            credentials = this.#normalizeCredentials(apiKey, apiSecret);
        } catch (err) {
            if (err instanceof AuthError) {
                this.#credentials = null;
                this.#shouldRelogin = false;
                this.emit('auth_error', err);

                return { ok: false, err };
            }

            throw err;
        }

        this.#credentials = credentials;

        if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
            const error = AuthError.network('BitMEX WS is not connected', { exchange: 'BitMEX' });

            this.emit('auth_error', error);

            return { ok: false, err: error };
        }

        return this.#performAuth('manual', { now: typeof now === 'function' ? now : Date.now });
    }

    async disconnect({ graceful = true }: { graceful?: boolean } = {}): Promise<void> {
        this.#manualClose = true;
        this.#clearReconnectTimer();
        this.#clearKeepaliveTimers();
        this.#clearAuthRetryTimer();
        this.#isAuthed = false;

        try {
            if (!this.#ws) {
                this.#log.info('BitMEX WS disconnect requested but no active socket');

                if (this.#connectPromise) {
                    this.#rejectPendingConnect(new Error('BitMEX WS disconnected'));
                }

                this.#transitionState('idle');

                return;
            }

            const ws = this.#ws;

            if (ws.readyState === WebSocket.CLOSED) {
                this.#cleanupWebSocket(ws);
                this.#transitionState('idle');
                this.#rejectPendingConnect(new Error('BitMEX WS disconnected'));

                return;
            }

            this.#transitionState('closing');
            this.#log.info('BitMEX WS disconnect → %s', graceful ? 'graceful' : 'terminate');

            await new Promise<void>(resolve => {
                const finalize = () => resolve();

                ws.once('close', finalize);

                try {
                    if (graceful) {
                        ws.close(1000, 'client-request');
                    } else {
                        ws.terminate();
                    }
                } catch (err) {
                    this.#log.warn('BitMEX WS disconnect error: %s', (err as Error).message);
                    resolve();
                }
            });
        } finally {
            this.#manualClose = false;
        }
    }

    send(raw: string): void {
        const { requiresAuth, op, privateArgs } = this.#inspectMessage(raw);

        if (op === 'subscribe') {
            for (const value of privateArgs) {
                this.#privateSubscriptions.add(value);
            }
        } else if (op === 'unsubscribe') {
            for (const value of privateArgs) {
                this.#privateSubscriptions.delete(value);
            }
        }

        if (this.isOpen() && (!requiresAuth || this.#isAuthed)) {
            this.#ws!.send(raw);

            return;
        }

        this.#bufferMessage(raw, requiresAuth);
    }

    #inspectMessage(raw: string): {
        requiresAuth: boolean;
        op?: string;
        privateArgs: string[];
    } {
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const op = typeof parsed.op === 'string' ? parsed.op : undefined;

            if (!op || (op !== 'subscribe' && op !== 'unsubscribe')) {
                return { requiresAuth: false, op, privateArgs: [] };
            }

            const args = Array.isArray(parsed.args) ? parsed.args : [];
            const privateArgs: string[] = [];

            for (const value of args) {
                if (typeof value !== 'string') {
                    continue;
                }

                const channel = value.split(':', 1)[0];

                if (PRIVATE_CHANNEL_PREFIXES.has(channel)) {
                    privateArgs.push(value);
                }
            }

            return { requiresAuth: privateArgs.length > 0, op, privateArgs };
        } catch {
            return { requiresAuth: false, op: undefined, privateArgs: [] };
        }
    }

    #bufferMessage(raw: string, requiresAuth: boolean): void {
        if (this.#sendBuffer.length >= this.#sendBufferLimit) {
            throw new ValidationError('BitMEX WS send buffer overflow', {
                details: { limit: this.#sendBufferLimit },
            });
        }

        if (requiresAuth && this.#pendingPrivateMessages.has(raw)) {
            return;
        }

        this.#sendBuffer.push({ raw, requiresAuth });

        if (requiresAuth) {
            this.#pendingPrivateMessages.add(raw);
        }
    }

    // region: auth -------------------------------------------------------------

    async #performAuth(source: AuthAttemptSource, opts: { now?: () => number } = {}): Promise<LoginResult> {
        if (!this.#credentials) {
            const error = AuthError.badCredentials('BitMEX API credentials are required', {
                exchange: 'BitMEX',
            });

            this.emit('auth_error', error);

            return { ok: false, err: error };
        }

        if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
            const error = AuthError.network('BitMEX WS is not connected', { exchange: 'BitMEX' });

            this.emit('auth_error', error);

            return { ok: false, err: error };
        }

        if (this.#pendingAuth) {
            const error = AuthError.network('BitMEX WS authentication already in progress', {
                exchange: 'BitMEX',
                requestId: this.#pendingAuth.requestId,
            });

            this.emit('auth_error', error);

            return { ok: false, err: error };
        }

        const now = opts.now ?? Date.now;
        const requestId = randomUUID();
        const startedAt = Date.now();
        const nowValue = now();
        const expires = this.#computeAuthExpires(nowValue);
        const signature = createHmac('sha256', this.#credentials.apiSecret)
            .update('GET/realtime' + String(expires))
            .digest('hex');

        const payload = JSON.stringify({
            op: 'authKeyExpires',
            args: [this.#credentials.apiKey, expires, signature],
        });

        const logger = this.#getAuthLogger(source);

        logger.info('BitMEX WS auth request', {
            requestId,
            ts: new Date(startedAt).toISOString(),
            expires,
            source,
        });

        return new Promise<LoginResult>(resolve => {
            const timeout = setTimeout(() => this.#handleAuthTimeout(requestId), this.#authTimeoutMs);

            this.#pendingAuth = {
                requestId,
                startedAt,
                timeout,
                resolve,
                source,
            } satisfies PendingAuth;

            try {
                this.#ws!.send(payload);
            } catch (err) {
                const error =
                    err instanceof AuthError
                        ? err
                        : AuthError.network('BitMEX WS auth send failed', {
                              exchange: 'BitMEX',
                              requestId,
                              cause: err,
                          });

                this.#failAuthAttempt(error, { reason: 'send_failed' });
            }
        });
    }

    #computeAuthExpires(timestampMs: number): number {
        return Math.floor(timestampMs / 1000) + this.#authExpiresSkewSec;
    }

    #normalizeCredentials(apiKey?: string, apiSecret?: string): BitmexCredentials {
        const envCredentials = getBitmexCredentials();
        const resolvedKey = apiKey?.trim() || envCredentials?.apiKey;
        const resolvedSecret = apiSecret?.trim() || envCredentials?.apiSecret;

        if (!resolvedKey || !resolvedSecret) {
            throw AuthError.badCredentials('BitMEX API credentials are required', {
                exchange: 'BitMEX',
            });
        }

        return { apiKey: resolvedKey, apiSecret: resolvedSecret };
    }

    #tryHandleAuthResponse(raw: string): void {
        const attempt = this.#pendingAuth;

        if (!attempt) {
            return;
        }

        let parsed: unknown;

        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }

        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        const body = parsed as Record<string, unknown>;
        const request = body.request as Record<string, unknown> | undefined;
        const op = typeof request?.op === 'string' ? request.op : undefined;

        if (op !== 'authKeyExpires') {
            return;
        }

        const serverRequestId = this.#extractRequestId(request);
        const success = body.success === true;

        if (success) {
            this.#handleAuthSuccess(serverRequestId);

            return;
        }

        const reason =
            typeof body.error === 'string'
                ? body.error
                : typeof body.message === 'string'
                  ? (body.message as string)
                  : undefined;

        const error = this.#mapAuthError(reason, {
            requestId: attempt.requestId,
            serverRequestId,
        });

        if (error.code === 'ALREADY_AUTHED') {
            this.#handleAuthAlreadyAuthed(serverRequestId);

            return;
        }

        this.#failAuthAttempt(error, { reason, serverRequestId });
    }

    #extractRequestId(request?: Record<string, unknown>): string | undefined {
        if (!request) {
            return undefined;
        }

        const candidates = ['id', 'requestId', 'requestID', 'reqId', 'reqID'];

        for (const key of candidates) {
            const value = request[key];

            if (typeof value === 'string' && value) {
                return value;
            }
        }

        return undefined;
    }

    #handleAuthSuccess(serverRequestId?: string): void {
        const attempt = this.#consumePendingAuth();

        if (!attempt) {
            return;
        }

        this.#finalizeAuthSuccess(attempt, serverRequestId, 'success');
    }

    #handleAuthAlreadyAuthed(serverRequestId?: string): void {
        const attempt = this.#consumePendingAuth();

        if (!attempt) {
            return;
        }

        this.#finalizeAuthSuccess(attempt, serverRequestId, 'already_authed');
    }

    #finalizeAuthSuccess(
        attempt: PendingAuth,
        serverRequestId: string | undefined,
        mode: 'success' | 'already_authed',
    ): void {
        this.#isAuthed = true;
        this.#shouldRelogin = true;
        this.#authRetryAttempts = 0;
        this.#clearAuthRetryTimer();

        const completedAt = Date.now();
        const latency = Math.max(0, completedAt - attempt.startedAt);
        const logger = this.#getAuthLogger(attempt.source);

        const logContext = {
            requestId: attempt.requestId,
            serverRequestId,
            ts: new Date(completedAt).toISOString(),
            latencyMs: latency,
            source: attempt.source,
        } as const;

        if (mode === 'already_authed') {
            logger.info('BitMEX WS auth already active', logContext);
        } else {
            logger.info('BitMEX WS auth success', logContext);
        }

        const metricLabels = {
            exchange: 'bitmex',
            env: this.#envLabel,
            ws: 'realtime',
        } as const;

        incrementCounter(AUTH_SUCCESS_COUNTER, 1, metricLabels);
        observeHistogram(AUTH_LATENCY_HISTOGRAM, latency, metricLabels);

        this.emit('authed', { ts: completedAt });
        this.#flushSendBuffer();

        if (attempt.source === 'reconnect') {
            this.#resubscribePrivateChannels();
        }

        attempt.resolve({ ok: true, ts: completedAt });
    }

    #failAuthAttempt(error: AuthError, context: { reason?: string; serverRequestId?: string } = {}): void {
        const attempt = this.#consumePendingAuth();

        if (!attempt) {
            return;
        }

        this.#isAuthed = false;

        const logger = this.#getAuthLogger(attempt.source);

        logger.error('BitMEX WS auth failed: %s', error.message, {
            requestId: attempt.requestId,
            serverRequestId: context.serverRequestId,
            reason: context.reason,
            ts: new Date().toISOString(),
            source: attempt.source,
            code: error.code,
        });

        if (error.code === 'BAD_CREDENTIALS' || error.code === 'CLOCK_SKEW') {
            this.#shouldRelogin = false;
        }

        const metricLabels = {
            exchange: 'bitmex',
            env: this.#envLabel,
            ws: 'realtime',
            reason: error.code,
        } as const;

        incrementCounter(AUTH_ERROR_COUNTER, 1, metricLabels);

        this.emit('auth_error', error);
        attempt.resolve({ ok: false, err: error });

        if (attempt.source === 'reconnect' && this.#shouldRelogin) {
            if (error.code === 'TIMEOUT' || error.code === 'NETWORK') {
                this.#scheduleAuthRetry(error);
            }
        }
    }

    #consumePendingAuth(): PendingAuth | null {
        const attempt = this.#pendingAuth;

        if (!attempt) {
            return null;
        }

        clearTimeout(attempt.timeout);
        this.#pendingAuth = null;

        return attempt;
    }

    #handleAuthTimeout(requestId: string): void {
        const attempt = this.#pendingAuth;

        if (!attempt || attempt.requestId !== requestId) {
            return;
        }

        const error = AuthError.timeout('BitMEX WS authentication timed out', {
            exchange: 'BitMEX',
            requestId,
        });

        this.#failAuthAttempt(error, { reason: 'timeout' });
    }

    #mapAuthError(reason: string | undefined, context: { requestId: string; serverRequestId?: string }): AuthError {
        const normalizedReason = reason?.toLowerCase() ?? '';
        const details: Record<string, unknown> = {};

        if (reason) {
            details.reason = reason;
        }

        if (context.serverRequestId) {
            details.serverRequestId = context.serverRequestId;
        }

        const baseOptions = {
            exchange: 'BitMEX' as const,
            requestId: context.requestId,
            details: Object.keys(details).length > 0 ? details : undefined,
        };

        if (!reason) {
            return new AuthError('BitMEX authentication failed', 'NETWORK', baseOptions);
        }

        if (BAD_CREDENTIAL_PATTERNS.some(pattern => normalizedReason.includes(pattern))) {
            return AuthError.badCredentials('BitMEX authentication failed: bad credentials', baseOptions);
        }

        if (CLOCK_SKEW_PATTERNS.some(pattern => normalizedReason.includes(pattern))) {
            return AuthError.clockSkew('BitMEX authentication failed: clock skew detected', baseOptions);
        }

        if (ALREADY_AUTHED_PATTERNS.some(pattern => normalizedReason.includes(pattern))) {
            return AuthError.alreadyAuthed('BitMEX authentication already active', baseOptions);
        }

        return new AuthError('BitMEX authentication failed', 'NETWORK', baseOptions);
    }

    #scheduleAuthRetry(error: AuthError): void {
        if (this.#authRetryTimer || this.#pendingAuth || !this.#shouldRelogin || !this.#credentials) {
            return;
        }

        this.#authRetryAttempts += 1;

        const delay = this.#computeAuthRetryDelay(this.#authRetryAttempts);

        this.#authReconnectLog.warn('BitMEX WS auth retry in %dms after %s', delay, error.code, {
            attempt: this.#authRetryAttempts,
            reason: error.code,
        });

        this.#clearAuthRetryTimer();
        this.#authRetryTimer = setTimeout(() => {
            this.#authRetryTimer = null;
            this.#triggerAutomaticRelogin();
        }, delay);
    }

    #computeAuthRetryDelay(attempt: number): number {
        const exponent = Math.max(0, attempt - 1);
        const delay = this.#reconnectOptions.baseDelayMs * 2 ** exponent;

        return Math.min(this.#reconnectOptions.maxDelayMs, delay);
    }

    #clearAuthRetryTimer(): void {
        if (this.#authRetryTimer) {
            clearTimeout(this.#authRetryTimer);
            this.#authRetryTimer = null;
        }
    }

    #getAuthLogger(source: AuthAttemptSource): Logger {
        return source === 'reconnect' ? this.#authReconnectLog : this.#authLog;
    }

    #triggerAutomaticRelogin(): void {
        if (!this.#shouldRelogin || !this.#credentials || this.#pendingAuth || this.#authRetryTimer) {
            return;
        }

        try {
            void this.#performAuth('reconnect').catch(err => {
                const error =
                    err instanceof AuthError
                        ? err
                        : AuthError.network(err?.message ?? 'BitMEX WS relogin failed', {
                              exchange: 'BitMEX',
                              cause: err,
                          });

                this.#failAuthAttempt(error);
            });
        } catch (err) {
            const error =
                err instanceof AuthError
                    ? err
                    : AuthError.network('BitMEX WS relogin failed to start', {
                          exchange: 'BitMEX',
                          cause: err,
                      });

            this.#authReconnectLog.error('BitMEX WS relogin start failed: %s', error.message, {
                ts: new Date().toISOString(),
            });
            this.emit('auth_error', error);
        }
    }

    // endregion

    // region: socket lifecycle -------------------------------------------------

    #openSocket(initialState: 'connecting' | 'reconnecting'): void {
        this.#clearReconnectTimer();
        this.#clearKeepaliveTimers();
        this.#cleanupWebSocket();
        this.#isAuthed = false;

        this.#transitionState(initialState);

        const attempt = this.#reconnectAttempts + 1;

        this.#log.info('BitMEX WS connect attempt %d → %s', attempt, this.#url);

        const ws = new WebSocket(this.#url);

        this.#ws = ws;

        ws.on('open', this.#handleOpen);
        ws.on('message', this.#handleMessage);
        ws.on('pong', this.#handlePong);
        ws.on('error', this.#handleError);
        ws.on('close', this.#handleClose);
    }

    #handleOpen = (): void => {
        if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.#transitionState('open');
        this.#reconnectAttempts = 0;

        this.#log.info('BitMEX WS open');

        this.#startKeepalive();
        this.#triggerAutomaticRelogin();
        this.#flushSendBuffer();
        this.#resolvePendingConnect();

        this.emit('open');
    };

    #handleMessage = (data: RawData): void => {
        const text = this.#normalizeMessage(data);

        this.#tryHandleAuthResponse(text);
        this.emit('message', text);
    };

    #handlePong = (): void => {
        this.#bumpPongDeadline();
    };

    #handleError = (err: Error): void => {
        if (this.#pendingAuth) {
            const error = AuthError.network('BitMEX WS auth failed: socket error', {
                exchange: 'BitMEX',
                cause: err,
            });

            this.#failAuthAttempt(error, { reason: 'socket_error' });
        }

        this.#log.warn('BitMEX WS error: %s', err?.message ?? 'unknown');
        this.emit('error', err);
    };

    #handleClose = (code: number, reasonBuf: Buffer): void => {
        const reason = reasonBuf?.toString('utf8') || undefined;

        const context = { code, reason, manual: this.#manualClose } as const;

        this.#log.info('BitMEX WS close', context);
        this.#isAuthed = false;
        this.#clearAuthRetryTimer();

        if (this.#pendingAuth) {
            const error = AuthError.network('BitMEX WS auth failed: socket closed', {
                exchange: 'BitMEX',
                requestId: this.#pendingAuth.requestId,
                details: { code, reason },
            });

            this.#failAuthAttempt(error, { reason: 'socket_closed' });
        }

        this.#clearKeepaliveTimers();
        this.emit('close', { code, reason });

        const ws = this.#ws;

        this.#cleanupWebSocket(ws ?? undefined);

        if (this.#manualClose) {
            this.#log.info('BitMEX WS close handled manually', context);
            this.#transitionState('idle');
            this.#rejectPendingConnect(new Error('BitMEX WS disconnected'));

            return;
        }

        if (code === 1000) {
            this.#log.info('BitMEX WS close — normal closure, staying idle', context);
            this.#transitionState('idle');
            this.#rejectPendingConnect(fromWsClose({ code, reason, exchange: 'BitMEX' }));

            return;
        }

        this.#scheduleReconnect(code, reason);
    };

    #cleanupWebSocket(socket?: WebSocket | null): void {
        const ws = socket ?? this.#ws;

        if (!ws) {
            this.#ws = null;

            return;
        }

        ws.off('open', this.#handleOpen);
        ws.off('message', this.#handleMessage);
        ws.off('pong', this.#handlePong);
        ws.off('error', this.#handleError);
        ws.off('close', this.#handleClose);

        if (!socket || socket === this.#ws) {
            this.#ws = null;
        }
    }

    // endregion

    // region: buffering -------------------------------------------------------

    #flushSendBuffer(): void {
        if (this.#sendBuffer.length === 0 || !this.isOpen()) {
            return;
        }

        const pending = this.#sendBuffer.slice();

        this.#sendBuffer.length = 0;

        for (let i = 0; i < pending.length; i += 1) {
            const message = pending[i];

            if (message.requiresAuth && !this.#isAuthed) {
                this.#sendBuffer.push(message);
                continue;
            }

            if (!this.isOpen()) {
                this.#log.warn('BitMEX WS flush aborted — socket not open');
                this.#sendBuffer.push(message, ...pending.slice(i + 1));
                break;
            }

            try {
                this.#ws!.send(message.raw);

                if (message.requiresAuth) {
                    this.#pendingPrivateMessages.delete(message.raw);
                }
            } catch (err) {
                this.#log.error('BitMEX WS flush error: %s', (err as Error).message);
                this.#sendBuffer.push(message, ...pending.slice(i + 1));
                break;
            }
        }
    }

    #resubscribePrivateChannels(): void {
        if (!this.isOpen() || !this.#isAuthed || this.#privateSubscriptions.size === 0) {
            return;
        }

        const args = Array.from(this.#privateSubscriptions).sort();
        const payload = JSON.stringify({ op: 'subscribe', args });

        this.#authReconnectLog.info('BitMEX WS resubscribing private channels', {
            count: args.length,
        });

        try {
            this.#ws!.send(payload);
        } catch (err) {
            this.#authReconnectLog.error('BitMEX WS resubscribe send failed: %s', (err as Error).message, {
                count: args.length,
            });

            try {
                this.#bufferMessage(payload, true);
            } catch (bufferErr) {
                this.#authReconnectLog.error('BitMEX WS resubscribe buffer failed: %s', (bufferErr as Error).message, {
                    count: args.length,
                });
            }
        }
    }

    // endregion

    // region: keepalive -------------------------------------------------------

    #startKeepalive(): void {
        this.#clearKeepaliveTimers();

        if (!this.isOpen()) {
            return;
        }

        this.#pingTimer = setInterval(() => {
            this.#sendPing();
        }, this.#pingIntervalMs);

        this.#sendPing();
    }

    #clearKeepaliveTimers(): void {
        if (this.#pingTimer) {
            clearInterval(this.#pingTimer);
            this.#pingTimer = null;
        }

        if (this.#pongTimer) {
            clearTimeout(this.#pongTimer);
            this.#pongTimer = null;
        }
    }

    #sendPing(): void {
        if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            this.#ws.ping();
            this.#bumpPongDeadline();
        } catch (err) {
            this.#log.warn('BitMEX WS ping error: %s', (err as Error).message);
        }
    }

    #bumpPongDeadline(): void {
        if (!this.isOpen()) {
            return;
        }

        if (this.#pongTimer) {
            clearTimeout(this.#pongTimer);
        }

        this.#pongTimer = setTimeout(() => {
            this.#handlePongTimeout();
        }, this.#pongTimeoutMs);
    }

    #handlePongTimeout(): void {
        if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.#log.warn('BitMEX WS pong timeout — terminating connection');

        try {
            this.#ws.terminate();
        } catch (err) {
            this.#log.warn('BitMEX WS terminate error: %s', (err as Error).message);
        }
    }

    // endregion

    // region: reconnect -------------------------------------------------------

    #scheduleReconnect(code?: number, reason?: string): void {
        const closeCode = code ?? 1006;

        if (this.#manualClose) {
            this.#log.debug('BitMEX WS reconnect skipped due to manual close', {
                code: closeCode,
                reason,
            });

            return;
        }

        if (closeCode === 1000) {
            this.#log.info('BitMEX WS reconnect skipped after normal closure', {
                code: closeCode,
                reason,
            });
            this.#transitionState('idle');

            const error = fromWsClose({ code: closeCode, reason, exchange: 'BitMEX' });

            this.#rejectPendingConnect(error);

            return;
        }

        const error = fromWsClose({
            code: closeCode,
            reason,
            exchange: 'BitMEX',
        });

        this.#reconnectAttempts += 1;

        if (this.#reconnectAttempts > this.#reconnectOptions.maxAttempts) {
            this.#log.error('BitMEX WS reconnect attempts exceeded', {
                attempts: this.#reconnectAttempts,
                code: closeCode,
                reason,
            });

            this.#transitionState('idle');
            this.#rejectPendingConnect(error);
            this.emit('error', error);

            return;
        }

        const delay = this.#computeReconnectDelay(this.#reconnectAttempts);

        this.#transitionState('reconnecting');
        this.#log.warn('BitMEX WS reconnect in %dms (attempt %d)', delay, this.#reconnectAttempts, {
            code: closeCode,
            reason,
        });

        this.#clearReconnectTimer();
        this.#reconnectTimer = setTimeout(() => {
            this.#openSocket('reconnecting');
        }, delay);
    }

    #computeReconnectDelay(attempt: number): number {
        const exponent = Math.max(0, attempt - 1);
        const delay = this.#reconnectOptions.baseDelayMs * 2 ** exponent;

        return Math.min(this.#reconnectOptions.maxDelayMs, delay);
    }

    #clearReconnectTimer(): void {
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
    }

    // endregion

    #normalizeMessage(data: RawData): string {
        if (typeof data === 'string') {
            return data;
        }

        if (Array.isArray(data)) {
            return Buffer.concat(data).toString('utf8');
        }

        if (data instanceof ArrayBuffer) {
            return Buffer.from(data).toString('utf8');
        }

        return (data as Buffer).toString('utf8');
    }

    #resolvePendingConnect(): void {
        if (this.#resolveConnect) {
            this.#resolveConnect();
        }

        this.#clearPendingConnect();
    }

    #rejectPendingConnect(err: Error): void {
        if (this.#rejectConnect) {
            this.#rejectConnect(err);
        }

        this.#clearPendingConnect();
    }

    #clearPendingConnect(): void {
        this.#connectPromise = null;
        this.#resolveConnect = undefined;
        this.#rejectConnect = undefined;
    }

    #transitionState(next: WsState): void {
        if (this.#state === next) {
            return;
        }

        const prev = this.#state;

        this.#state = next;
        this.#log.info('BitMEX WS state %s → %s', prev, next);
    }
}
