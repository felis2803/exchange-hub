declare module 'ws' {
  import { EventEmitter } from 'node:events';

  export type RawData = string | ArrayBuffer | Buffer | Buffer[];

  export default class WebSocket extends EventEmitter {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    readonly url: string;
    readyState: number;

    constructor(address: string, options?: unknown);

    send(data: unknown): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(data?: unknown): void;
  }
}
