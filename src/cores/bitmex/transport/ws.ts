import { EventEmitter } from 'node:events';

import WebSocket from 'ws';
import type { RawData } from 'ws';

import { createLogger } from '../../../infra/logger.js';
import { ValidationError, fromWsClose } from '../../../infra/errors.js';
import {
  BITMEX_WS_ENDPOINTS,
  WS_PING_INTERVAL_MS,
  WS_PONG_TIMEOUT_MS,
  WS_RECONNECT_BASE_DELAY_MS,
  WS_RECONNECT_MAX_ATTEMPTS,
  WS_RECONNECT_MAX_DELAY_MS,
  WS_SEND_BUFFER_LIMIT,
} from '../constants.js';

export type WsState = 'idle' | 'connecting' | 'open' | 'closing' | 'reconnecting';

export interface BitmexWsOptions {
  isTest?: boolean;
  url?: string;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
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
}

interface NormalizedReconnectOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export class BitmexWsClient extends EventEmitter {
  private readonly url: string;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly sendBufferLimit: number;
  private readonly reconnectOptions: NormalizedReconnectOptions;

  private ws: WebSocket | null = null;
  private state: WsState = 'idle';
  private sendBuffer: string[] = [];
  private reconnectAttempts = 0;
  private manualCloseRequested = false;

  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private connectPromise: Promise<void> | null = null;
  private resolveConnect?: () => void;
  private rejectConnect?: (err: Error) => void;

  private readonly log = createLogger('bitmex:ws');

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
      reconnect,
      sendBufferLimit = WS_SEND_BUFFER_LIMIT,
    } = opts;

    const {
      baseDelayMs = WS_RECONNECT_BASE_DELAY_MS,
      maxDelayMs = WS_RECONNECT_MAX_DELAY_MS,
      maxAttempts = WS_RECONNECT_MAX_ATTEMPTS,
    } = reconnect ?? {};

    this.url = url ?? (isTest ? BITMEX_WS_ENDPOINTS.testnet : BITMEX_WS_ENDPOINTS.mainnet);
    this.pingIntervalMs = pingIntervalMs;
    this.pongTimeoutMs = pongTimeoutMs;
    this.sendBufferLimit = sendBufferLimit;
    this.reconnectOptions = {
      baseDelayMs,
      maxDelayMs,
      maxAttempts,
    } satisfies NormalizedReconnectOptions;
  }

  getState(): WsState {
    return this.state;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    this.manualCloseRequested = false;

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

  async disconnect({ graceful = true }: { graceful?: boolean } = {}): Promise<void> {
    this.manualCloseRequested = true;
    this.clearReconnectTimer();
    this.stopKeepalive();

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
      this.manualCloseRequested = false;
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

  // region: socket lifecycle -------------------------------------------------

  protected openSocket(initialState: 'connecting' | 'reconnecting'): void {
    this.clearReconnectTimer();
    this.stopKeepalive();
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
    this.manualCloseRequested = false;

    this.log.info('BitMEX WS open');

    this.startKeepalive();
    this.flushSendBuffer();
    this.resolvePendingConnect();

    this.emit('open');
  };

  private readonly handleMessage = (data: RawData): void => {
    const text = this.normalizeMessage(data);
    this.emit('message', text);
    this.bumpPongDeadline();
  };

  private readonly handlePong = (): void => {
    this.bumpPongDeadline();
  };

  private readonly handleError = (err: Error): void => {
    this.log.warn('BitMEX WS error: %s', err?.message ?? 'unknown');
    this.emit('error', err);
  };

  private readonly handleClose = (code: number, reasonBuf: Buffer): void => {
    const reason = reasonBuf?.toString('utf8') || undefined;

    this.log.warn('BitMEX WS close', { code, reason });

    this.stopKeepalive();
    this.emit('close', { code, reason });

    const ws = this.ws;
    this.cleanupWebSocket(ws ?? undefined);

    if (this.manualCloseRequested) {
      this.manualCloseRequested = false;
      this.transitionState('idle');
      this.rejectPendingConnect(new Error('BitMEX WS disconnected'));
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
    if (!this.isOpen() || this.sendBuffer.length === 0) {
      return;
    }

    const pending = this.sendBuffer.slice();
    this.sendBuffer.length = 0;

    for (let i = 0; i < pending.length; i += 1) {
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
    this.stopKeepalive();

    if (!this.isOpen()) {
      return;
    }

    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch (err) {
          this.log.warn('BitMEX WS ping error: %s', (err as Error).message);
        }
      }

      this.bumpPongDeadline();
    }, this.pingIntervalMs);

    this.bumpPongDeadline();
  }

  private stopKeepalive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
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
    const error = fromWsClose({
      code: code ?? 1006,
      reason,
      exchange: 'BitMEX',
    });

    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > this.reconnectOptions.maxAttempts) {
      this.log.error('BitMEX WS reconnect attempts exceeded', {
        attempts: this.reconnectAttempts,
        code,
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
      code,
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

    this.state = next;
    this.log.debug('BitMEX WS state → %s', next);
  }
}
