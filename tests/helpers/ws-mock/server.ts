import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';

import type { TestClock } from '../clock.js';

import type { PrivateTable, ScenarioEvent } from './scenario.js';
import { ScenarioScript } from './scenario.js';

type MessagePredicate = (message: unknown) => boolean;

class SessionContext {
  readonly socket: WebSocket;
  #clock: TestClock;
  #messages: unknown[] = [];
  #closed = false;
  #closedPromise: Promise<void>;
  #resolveClosed!: () => void;
  #nextAuthMode: 'success' | 'already-authed' = 'success';

  constructor(socket: WebSocket, clock: TestClock) {
    this.socket = socket;
    this.#clock = clock;
    this.#closedPromise = new Promise<void>((resolve) => {
      this.#resolveClosed = resolve;
    });

    socket.on('message', (raw) => {
      const parsed = this.#parseMessage(raw);
      this.#messages.push(parsed);
    });

    socket.on('close', () => {
      this.#closed = true;
      this.#resolveClosed();
    });
  }

  requireAuth(): void {
    // noop, reserved for clarity.
  }

  setAuthMode(mode: 'success' | 'already-authed'): void {
    this.#nextAuthMode = mode;
  }

  async expectAuth(): Promise<void> {
    const request = await this.#nextMessage((message) => {
      return typeof message === 'object' && message !== null && (message as any).op === 'authKeyExpires';
    });

    const { mode } = this;

    const response =
      mode === 'already-authed'
        ? { success: false, error: 'Already authenticated', request }
        : { success: true, request };

    this.socket.send(JSON.stringify(response));
    this.#nextAuthMode = 'success';
  }

  async expectSubscribe(channels: string[]): Promise<void> {
    await this.#nextMessage((message) => {
      if (typeof message !== 'object' || message === null) {
        return false;
      }

      const op = (message as any).op;
      if (op !== 'subscribe') {
        return false;
      }

      const args = Array.isArray((message as any).args) ? ((message as any).args as unknown[]) : [];
      const normalized = args.filter((value): value is string => typeof value === 'string');

      return channels.every((channel) => normalized.includes(channel));
    });
  }

  sendSubscribeAck(channels: string[]): void {
    for (const channel of channels) {
      const payload = {
        success: true,
        subscribe: channel,
        request: { op: 'subscribe', args: channels },
      };
      this.socket.send(JSON.stringify(payload));
    }
  }

  sendChannel(table: PrivateTable, action: 'partial' | 'insert' | 'update' | 'delete', data: unknown[]): void {
    const payload = { table, action, data };
    this.socket.send(JSON.stringify(payload));
  }

  drop(code?: number, reason?: string): void {
    this.socket.close(code ?? 4000, reason ?? 'scenario-drop');
  }

  waitForClose(): Promise<void> {
    return this.#closedPromise;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get mode(): 'success' | 'already-authed' {
    return this.#nextAuthMode;
  }

  async #nextMessage(predicate: MessagePredicate, timeoutMs = 5_000): Promise<any> {
    let result: unknown;

    await this.#clock.waitFor(() => {
      for (let index = 0; index < this.#messages.length; index += 1) {
        const message = this.#messages[index];
        if (!predicate(message)) {
          continue;
        }

        result = message;
        this.#messages.splice(index, 1);
        return true;
      }

      return false;
    }, { timeoutMs, intervalMs: 5 });

    return result;
  }

  #parseMessage(raw: unknown): unknown {
    if (typeof raw === 'string') {
      return this.#parseJson(raw);
    }

    if (raw instanceof Buffer || Array.isArray(raw)) {
      const text = raw.toString();
      return this.#parseJson(text);
    }

    return raw;
  }

  #parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

interface ScenarioServerOptions {
  clock: TestClock;
}

type DispatchResult = 'continue' | 'wait-next-connection';

export class ScenarioServer {
  #clock: TestClock;
  #script: ScenarioScript;
  #server: WebSocketServer | null = null;
  #eventIndex = 0;
  #timelineCursor = 0;
  #completionPromise: Promise<void>;
  #resolveCompletion!: () => void;
  #rejectCompletion!: (reason: unknown) => void;

  constructor(script: ScenarioScript, options: ScenarioServerOptions) {
    this.#clock = options.clock;
    this.#script = script;
    this.#completionPromise = new Promise<void>((resolve, reject) => {
      this.#resolveCompletion = resolve;
      this.#rejectCompletion = reject;
    });
  }

  get url(): string {
    if (!this.#server) {
      throw new Error('Scenario server is not running');
    }

    const address = this.#server.address();
    if (typeof address === 'string' || !address) {
      throw new Error('Scenario server address is not available');
    }

    return `ws://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    if (this.#server) {
      return;
    }

    this.#server = new WebSocketServer({ port: 0 });

    this.#server.on('connection', (socket) => {
      const session = new SessionContext(socket, this.#clock);
      this.#handleSession(session).catch((err) => {
        this.#rejectCompletion(err);
      });
    });

    await new Promise<void>((resolve) => {
      this.#server!.once('listening', resolve);
    });
  }

  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    this.#server = null;
  }

  waitForCompletion(): Promise<void> {
    return this.#completionPromise;
  }

  async #handleSession(session: SessionContext): Promise<void> {
    if (this.#eventIndex >= this.#script.events.length) {
      session.drop(1000, 'scenario-complete');
      return;
    }

    while (this.#eventIndex < this.#script.events.length) {
      const event = this.#script.events[this.#eventIndex];

      await this.#advanceTo(event.at);

      const action = await this.#dispatchEvent(event, session);
      this.#eventIndex += 1;

      if (action === 'wait-next-connection') {
        break;
      }
    }

    if (this.#eventIndex >= this.#script.events.length) {
      this.#resolveCompletion();
    }
  }

  async #advanceTo(target: number): Promise<void> {
    const diff = target - this.#timelineCursor;
    if (diff > 0) {
      await this.#clock.wait(diff);
      this.#timelineCursor = target;
    }
  }

  async #dispatchEvent(event: ScenarioEvent, session: SessionContext): Promise<DispatchResult> {
    switch (event.type) {
      case 'delay': {
        await this.#clock.wait(event.duration);
        this.#timelineCursor += event.duration;
        return 'continue';
      }
      case 'require-auth':
        session.requireAuth();
        return 'continue';
      case 'expect-auth':
        await session.expectAuth();
        return 'continue';
      case 'set-auth-mode':
        session.setAuthMode(event.mode);
        return 'continue';
      case 'expect-subscribe':
        await session.expectSubscribe(event.channels);
        return 'continue';
      case 'send-subscribe-ack':
        session.sendSubscribeAck(event.channels);
        return 'continue';
      case 'send':
        session.sendChannel(event.table, event.action, event.data);
        return 'continue';
      case 'drop':
        session.drop(event.code, event.reason);
        await session.waitForClose();
        return 'continue';
      case 'accept-reconnect':
        if (session.closed) {
          await this.#clock.wait(100);
          return 'wait-next-connection';
        }
        return 'continue';
      case 'open':
        return 'continue';
      default:
        return 'continue';
    }
  }
}

