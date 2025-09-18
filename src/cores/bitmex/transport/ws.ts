import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import WebSocket from 'ws';
import type { RawData } from 'ws';

import { createLogger } from '../../../infra/logger.js';
import type { Logger } from '../../../infra/logger.js';
import {
  AuthBadCredentialsError,
  AuthClockSkewError,
  AuthError,
  AuthTimeoutError,
  NetworkError,
  ValidationError,
  fromWsClose,
} from '../../../infra/errors.js';
import { incrementCounter, observeHistogram } from '../../../infra/metrics.js';
import { getAuthExpiresSkewSec, getBitmexCredentials } from '../../../config/bitmex.js';
import type { BitmexCredentials } from '../../../config/bitmex.js';
import {
  BITMEX_WS_ENDPOINTS,
  WS_PING_INTERVAL_MS,
  WS_PONG_TIMEOUT_MS,
  WS_RECONNECT_BASE_DELAY_MS,
  WS_RECONNECT_MAX_ATTEMPTS,
  WS_RECONNECT_MAX_DELAY_MS,
  WS_SEND_BUFFER_LIMIT,
} from '../constants.js';

const AUTH_SUCCESS_COUNTER = 'auth_success_total';
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
  auth_error: (err: AuthError | NetworkError) => void;
}

interface NormalizedReconnectOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

type AuthAttemptSource = 'manual' | 'reconnect';

interface PendingAuth {
  requestId: string;
  startedAt: number;
  timeout: NodeJS.Timeout;
  resolve: () => void;
  reject: (err: AuthError | NetworkError) => void;
  source: AuthAttemptSource;
}

export class BitmexWsClient extends EventEmitter {
  private readonly url: string;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly sendBufferLimit: number;
  private readonly reconnectOptions: NormalizedReconnectOptions;
  private readonly authTimeoutMs: number;
  private readonly authExpiresSkewSec: number;

  private ws: WebSocket | null = null;
  private state: WsState = 'idle';
  private sendBuffer: string[] = [];
  private reconnectAttempts = 0;
  private manualClose = false;
  private credentials: BitmexCredentials | null = null;
  private shouldRelogin = false;
  private pendingAuth: PendingAuth | null = null;

  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private connectPromise: Promise<void> | null = null;
  private resolveConnect?: () => void;
  private rejectConnect?: (err: Error) => void;

  private readonly log = createLogger('bitmex:ws');
  private readonly authLog = this.log.withTags(['auth', 'ws']);
  private readonly authReconnectLog = this.authLog.withTags(['reconnect']);

  override on<Event extends keyof BitmexWsEvents>(
    event: Event,
    listener: BitmexWsEvents[Event],
  ): this;
  override on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override once<Event extends keyof BitmexWsEvents>(
    event: Event,
    listener: BitmexWsEvents[Event],
  ): this;
  override once(event: string | symbol, listener: (...args: unknown[]) => void): this;
  override once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  override off<Event extends keyof BitmexWsEvents>(
    event: Event,
    listener: BitmexWsEvents[Event],
  ): this;
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
      typeof authExpiresSkewSec === 'number' &&
      Number.isFinite(authExpiresSkewSec) &&
      authExpiresSkewSec > 0
        ? Math.max(1, Math.trunc(authExpiresSkewSec))
        : envAuthSkew;

    this.url = url ?? (isTest ? BITMEX_WS_ENDPOINTS.testnet : BITMEX_WS_ENDPOINTS.mainnet);
    this.pingIntervalMs = pingIntervalMs;
    this.pongTimeoutMs = pongTimeoutMs;
    this.sendBufferLimit = sendBufferLimit;
    this.reconnectOptions = {
      baseDelayMs,
      maxDelayMs,
      maxAttempts,
    } satisfies NormalizedReconnectOptions;
    this.authTimeoutMs = normalizedAuthTimeout;
    this.authExpiresSkewSec = normalizedAuthExpiresSkew;
  }

  getState(): WsState {
    return this.state;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    this.manualClose = false;

    if (this.isOpen()) {
      this.log.info('BitMEX WS already open', { url: this.url });
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = new Promise<void>((resolve, reject) => {
        this.resolveConnect = resolve;
        this.rejectConnect = reject;
      });
    }

    if (this.state === 'connecting' || this.state === 'reconnecting') {
      return this.connectPromise;
    }

    this.reconnectAttempts = 0;
    this.openSocket('connecting');

    return this.connectPromise;
  }

  async login(apiKey?: string, apiSecret?: string): Promise<void> {
    const credentials = this.normalizeCredentials(apiKey, apiSecret);
    this.credentials = credentials;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new NetworkError('BitMEX WS is not connected', { exchange: 'BitMEX' });
    }

    await this.performAuth('manual');
  }

  async disconnect({ graceful = true }: { graceful?: boolean } = {}): Promise<void> {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.clearKeepaliveTimers();

    try {
      if (!this.ws) {
        this.log.info('BitMEX WS disconnect requested but no active socket');
        if (this.connectPromise) {
          this.rejectPendingConnect(new Error('BitMEX WS disconnected'));
        }
        this.transitionState('idle');
        return;
      }

      const ws = this.ws;

      if (ws.readyState === WebSocket.CLOSED) {
        this.cleanupWebSocket(ws);
        this.transitionState('idle');
        this.rejectPendingConnect(new Error('BitMEX WS disconnected'));
        return;
      }

      this.transitionState('closing');
      this.log.info('BitMEX WS disconnect → %s', graceful ? 'graceful' : 'terminate');

      await new Promise<void>((resolve) => {
        const finalize = () => resolve();
        ws.once('close', finalize);

        try {
          if (graceful) {
            ws.close(1000, 'client-request');
          } else {
            ws.terminate();
          }
        } catch (err) {
          this.log.warn('BitMEX WS disconnect error: %s', (err as Error).message);
          resolve();
        }
      });
    } finally {
      this.manualClose = false;
    }
  }

  send(raw: string): void {
    if (this.isOpen()) {
      this.ws!.send(raw);
      return;
    }

    if (this.sendBuffer.length >= this.sendBufferLimit) {
      throw new ValidationError('BitMEX WS send buffer overflow', {
        details: { limit: this.sendBufferLimit },
      });
    }

    this.sendBuffer.push(raw);
  }

  // region: auth -------------------------------------------------------------

  private async performAuth(source: AuthAttemptSource): Promise<void> {
    if (!this.credentials) {
      throw new AuthError('BitMEX API credentials are required', { exchange: 'BitMEX' });
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new NetworkError('BitMEX WS is not connected', { exchange: 'BitMEX' });
    }

    if (this.pendingAuth) {
      throw new AuthError('BitMEX WS authentication already in progress', {
        exchange: 'BitMEX',
        requestId: this.pendingAuth.requestId,
      });
    }

    const requestId = randomUUID();
    const startedAt = Date.now();
    const expires = this.computeAuthExpires();
    const signature = createHmac('sha256', this.credentials.apiSecret)
      .update(`GET/realtime${expires}`)
      .digest('hex');

    const payload = JSON.stringify({
      op: 'authKeyExpires',
      args: [this.credentials.apiKey, expires, signature],
    });

    const logger = this.getAuthLogger(source);
    logger.info('BitMEX WS auth request', {
      requestId,
      ts: new Date(startedAt).toISOString(),
      expires,
      source,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => this.handleAuthTimeout(requestId), this.authTimeoutMs);
      this.pendingAuth = {
        requestId,
        startedAt,
        timeout,
        resolve,
        reject,
        source,
      } satisfies PendingAuth;

      try {
        this.ws!.send(payload);
      } catch (err) {
        const error =
          err instanceof AuthError || err instanceof NetworkError
            ? err
            : new NetworkError('BitMEX WS auth send failed', {
                exchange: 'BitMEX',
                requestId,
                cause: err,
              });
        this.failAuthAttempt(error, { reason: 'send_failed' });
      }
    });
  }

  private computeAuthExpires(): number {
    return Math.round(Date.now() / 1000) + this.authExpiresSkewSec;
  }

  private normalizeCredentials(apiKey?: string, apiSecret?: string): BitmexCredentials {
    const envCredentials = getBitmexCredentials();
    const resolvedKey = apiKey?.trim() || envCredentials?.apiKey;
    const resolvedSecret = apiSecret?.trim() || envCredentials?.apiSecret;

    if (!resolvedKey || !resolvedSecret) {
      throw new AuthError('BitMEX API credentials are required', { exchange: 'BitMEX' });
    }

    return { apiKey: resolvedKey, apiSecret: resolvedSecret };
  }

  private tryHandleAuthResponse(raw: string): void {
    if (!this.pendingAuth) {
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

    const serverRequestId = this.extractRequestId(request);
    const success = body.success === true;

    if (success) {
      this.handleAuthSuccess(serverRequestId);
      return;
    }

    const reason =
      typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string'
          ? (body.message as string)
          : undefined;
    const attempt = this.pendingAuth;
    if (!attempt) {
      return;
    }

    const error = this.mapAuthError(reason, {
      requestId: attempt.requestId,
      serverRequestId,
    });

    this.failAuthAttempt(error, { reason, serverRequestId });
  }

  private extractRequestId(request?: Record<string, unknown>): string | undefined {
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

  private handleAuthSuccess(serverRequestId?: string): void {
    const attempt = this.consumePendingAuth();
    if (!attempt) {
      return;
    }

    this.shouldRelogin = true;

    const completedAt = Date.now();
    const latency = completedAt - attempt.startedAt;
    const logger = this.getAuthLogger(attempt.source);

    logger.info('BitMEX WS auth success', {
      requestId: attempt.requestId,
      serverRequestId,
      ts: new Date(completedAt).toISOString(),
      latencyMs: latency,
      source: attempt.source,
    });

    incrementCounter(AUTH_SUCCESS_COUNTER, 1, { source: attempt.source });
    observeHistogram(AUTH_LATENCY_HISTOGRAM, latency, { source: attempt.source });

    this.emit('authed', { ts: completedAt });
    attempt.resolve();
  }

  private failAuthAttempt(
    error: AuthError | NetworkError,
    context: { reason?: string; serverRequestId?: string } = {},
  ): void {
    const attempt = this.consumePendingAuth();
    if (!attempt) {
      return;
    }

    const logger = this.getAuthLogger(attempt.source);
    logger.error('BitMEX WS auth failed: %s', error.message, {
      requestId: attempt.requestId,
      serverRequestId: context.serverRequestId,
      reason: context.reason,
      ts: new Date().toISOString(),
      source: attempt.source,
    });

    if (error instanceof AuthBadCredentialsError || error instanceof AuthClockSkewError) {
      this.shouldRelogin = false;
    }

    this.emit('auth_error', error);
    attempt.reject(error);
  }

  private consumePendingAuth(): PendingAuth | null {
    const attempt = this.pendingAuth;
    if (!attempt) {
      return null;
    }

    clearTimeout(attempt.timeout);
    this.pendingAuth = null;
    return attempt;
  }

  private handleAuthTimeout(requestId: string): void {
    const attempt = this.pendingAuth;
    if (!attempt || attempt.requestId !== requestId) {
      return;
    }

    const error = new AuthTimeoutError('BitMEX WS authentication timed out', {
      exchange: 'BitMEX',
      requestId,
    });
    this.failAuthAttempt(error, { reason: 'timeout' });
  }

  private mapAuthError(
    reason: string | undefined,
    context: { requestId: string; serverRequestId?: string },
  ): AuthError {
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
      return new AuthError('BitMEX authentication failed', baseOptions);
    }

    if (BAD_CREDENTIAL_PATTERNS.some((pattern) => normalizedReason.includes(pattern))) {
      return new AuthBadCredentialsError(
        'BitMEX authentication failed: bad credentials',
        baseOptions,
      );
    }

    if (CLOCK_SKEW_PATTERNS.some((pattern) => normalizedReason.includes(pattern))) {
      return new AuthClockSkewError(
        'BitMEX authentication failed: clock skew detected',
        baseOptions,
      );
    }

    return new AuthError('BitMEX authentication failed', baseOptions);
  }

  private getAuthLogger(source: AuthAttemptSource): Logger {
    return source === 'reconnect' ? this.authReconnectLog : this.authLog;
  }

  private triggerAutomaticRelogin(): void {
    if (!this.shouldRelogin || !this.credentials || this.pendingAuth) {
      return;
    }

    try {
      void this.performAuth('reconnect').catch(() => {
        // Failure is reported via failAuthAttempt / auth_error event.
      });
    } catch (err) {
      const error =
        err instanceof AuthError || err instanceof NetworkError
          ? err
          : new AuthError('BitMEX WS relogin failed to start', {
              exchange: 'BitMEX',
              cause: err,
            });

      this.authReconnectLog.error('BitMEX WS relogin start failed: %s', error.message, {
        ts: new Date().toISOString(),
      });
      this.emit('auth_error', error);
    }
  }

  // endregion

  // region: socket lifecycle -------------------------------------------------

  protected openSocket(initialState: 'connecting' | 'reconnecting'): void {
    this.clearReconnectTimer();
    this.clearKeepaliveTimers();
    this.cleanupWebSocket();

    this.transitionState(initialState);
    const attempt = this.reconnectAttempts + 1;
    this.log.info('BitMEX WS connect attempt %d → %s', attempt, this.url);

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', this.handleOpen);
    ws.on('message', this.handleMessage);
    ws.on('pong', this.handlePong);
    ws.on('error', this.handleError);
    ws.on('close', this.handleClose);
  }

  private readonly handleOpen = (): void => {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.transitionState('open');
    this.reconnectAttempts = 0;

    this.log.info('BitMEX WS open');

    this.startKeepalive();
    this.triggerAutomaticRelogin();
    this.flushSendBuffer();
    this.resolvePendingConnect();

    this.emit('open');
  };

  private readonly handleMessage = (data: RawData): void => {
    const text = this.normalizeMessage(data);
    this.tryHandleAuthResponse(text);
    this.emit('message', text);
  };

  private readonly handlePong = (): void => {
    this.bumpPongDeadline();
  };

  private readonly handleError = (err: Error): void => {
    if (this.pendingAuth) {
      const error = new NetworkError('BitMEX WS auth failed: socket error', {
        exchange: 'BitMEX',
        cause: err,
      });
      this.failAuthAttempt(error, { reason: 'socket_error' });
    }

    this.log.warn('BitMEX WS error: %s', err?.message ?? 'unknown');
    this.emit('error', err);
  };

  private readonly handleClose = (code: number, reasonBuf: Buffer): void => {
    const reason = reasonBuf?.toString('utf8') || undefined;

    const context = { code, reason, manual: this.manualClose } as const;

    this.log.info('BitMEX WS close', context);

    if (this.pendingAuth) {
      const error = new NetworkError('BitMEX WS auth failed: socket closed', {
        exchange: 'BitMEX',
        requestId: this.pendingAuth.requestId,
        details: { code, reason },
      });
      this.failAuthAttempt(error, { reason: 'socket_closed' });
    }

    this.clearKeepaliveTimers();
    this.emit('close', { code, reason });

    const ws = this.ws;
    this.cleanupWebSocket(ws ?? undefined);

    if (this.manualClose) {
      this.log.info('BitMEX WS close handled manually', context);
      this.transitionState('idle');
      this.rejectPendingConnect(new Error('BitMEX WS disconnected'));
      return;
    }

    if (code === 1000) {
      this.log.info('BitMEX WS close — normal closure, staying idle', context);
      this.transitionState('idle');
      this.rejectPendingConnect(fromWsClose({ code, reason, exchange: 'BitMEX' }));
      return;
    }

    this.scheduleReconnect(code, reason);
  };

  private cleanupWebSocket(socket?: WebSocket | null): void {
    const ws = socket ?? this.ws;
    if (!ws) {
      this.ws = null;
      return;
    }

    ws.off('open', this.handleOpen);
    ws.off('message', this.handleMessage);
    ws.off('pong', this.handlePong);
    ws.off('error', this.handleError);
    ws.off('close', this.handleClose);

    if (!socket || socket === this.ws) {
      this.ws = null;
    }
  }

  // endregion

  // region: buffering -------------------------------------------------------

  private flushSendBuffer(): void {
    if (this.sendBuffer.length === 0) {
      return;
    }

    if (!this.isOpen()) {
      return;
    }

    const pending = this.sendBuffer.slice();
    this.sendBuffer.length = 0;

    for (let i = 0; i < pending.length; i += 1) {
      if (!this.isOpen()) {
        this.log.warn('BitMEX WS flush aborted — socket not open');
        this.sendBuffer = pending.slice(i);
        break;
      }

      const message = pending[i];
      try {
        this.ws!.send(message);
      } catch (err) {
        this.log.error('BitMEX WS flush error: %s', (err as Error).message);
        this.sendBuffer = pending.slice(i);
        break;
      }
    }
  }

  // endregion

  // region: keepalive -------------------------------------------------------

  private startKeepalive(): void {
    this.clearKeepaliveTimers();

    if (!this.isOpen()) {
      return;
    }

    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, this.pingIntervalMs);

    this.sendPing();
  }

  private clearKeepaliveTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.ws.ping();
      this.bumpPongDeadline();
    } catch (err) {
      this.log.warn('BitMEX WS ping error: %s', (err as Error).message);
    }
  }

  private bumpPongDeadline(): void {
    if (!this.isOpen()) {
      return;
    }

    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
    }

    this.pongTimer = setTimeout(() => {
      this.handlePongTimeout();
    }, this.pongTimeoutMs);
  }

  protected handlePongTimeout(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.log.warn('BitMEX WS pong timeout — terminating connection');

    try {
      this.ws.terminate();
    } catch (err) {
      this.log.warn('BitMEX WS terminate error: %s', (err as Error).message);
    }
  }

  // endregion

  // region: reconnect -------------------------------------------------------

  private scheduleReconnect(code?: number, reason?: string): void {
    const closeCode = code ?? 1006;

    if (this.manualClose) {
      this.log.debug('BitMEX WS reconnect skipped due to manual close', {
        code: closeCode,
        reason,
      });
      return;
    }

    if (closeCode === 1000) {
      this.log.info('BitMEX WS reconnect skipped after normal closure', {
        code: closeCode,
        reason,
      });
      this.transitionState('idle');
      const error = fromWsClose({ code: closeCode, reason, exchange: 'BitMEX' });
      this.rejectPendingConnect(error);
      return;
    }

    const error = fromWsClose({
      code: closeCode,
      reason,
      exchange: 'BitMEX',
    });

    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > this.reconnectOptions.maxAttempts) {
      this.log.error('BitMEX WS reconnect attempts exceeded', {
        attempts: this.reconnectAttempts,
        code: closeCode,
        reason,
      });

      this.transitionState('idle');
      this.rejectPendingConnect(error);
      this.emit('error', error);
      return;
    }

    const delay = this.computeReconnectDelay(this.reconnectAttempts);

    this.transitionState('reconnecting');
    this.log.warn('BitMEX WS reconnect in %dms (attempt %d)', delay, this.reconnectAttempts, {
      code: closeCode,
      reason,
    });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.openSocket('reconnecting');
    }, delay);
  }

  private computeReconnectDelay(attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    const delay = this.reconnectOptions.baseDelayMs * 2 ** exponent;
    return Math.min(this.reconnectOptions.maxDelayMs, delay);
  }

  protected clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // endregion

  private normalizeMessage(data: RawData): string {
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

  private resolvePendingConnect(): void {
    if (this.resolveConnect) {
      this.resolveConnect();
    }

    this.clearPendingConnect();
  }

  private rejectPendingConnect(err: Error): void {
    if (this.rejectConnect) {
      this.rejectConnect(err);
    }

    this.clearPendingConnect();
  }

  private clearPendingConnect(): void {
    this.connectPromise = null;
    this.resolveConnect = undefined;
    this.rejectConnect = undefined;
  }

  private transitionState(next: WsState): void {
    if (this.state === next) {
      return;
    }

    const prev = this.state;
    this.state = next;
    this.log.info('BitMEX WS state %s → %s', prev, next);
  }
}
