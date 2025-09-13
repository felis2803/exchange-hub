import { createHmac } from 'crypto';

import type { BitMexChannel } from './types';

export class BitMexTransport {
    #endpoint: string;
    #ws?: WebSocket;

    constructor(endpoint: string) {
        this.#endpoint = endpoint;
    }

    async connect(isPublicOnly: boolean, apiKey?: string, apiSec?: string): Promise<void> {
        this.#ws = new WebSocket(this.#endpoint);

        await new Promise<void>((resolve, reject) => {
            this.#ws?.addEventListener('open', () => resolve());
            this.#ws?.addEventListener('error', err => reject(err));
        });

        if (!isPublicOnly && apiKey && apiSec) {
            const expires = Math.round(Date.now() / 1000) + 60;
            const signature = createHmac('sha256', apiSec).update(`GET/realtime${expires}`).digest('hex');

            this.send({ op: 'authKeyExpires', args: [apiKey, expires, signature] });
        }
    }

    async disconnect(): Promise<void> {
        if (!this.#ws) return;

        await new Promise<void>(resolve => {
            this.#ws?.addEventListener('close', () => resolve());
            this.#ws?.close();
        });

        this.#ws = undefined;
    }

    isConnected(): boolean {
        return !!this.#ws;
    }

    subscribe(channels: BitMexChannel[]): void {
        this.send({ op: 'subscribe', args: channels });
    }

    unsubscribe(channels: BitMexChannel[]): void {
        this.send({ op: 'unsubscribe', args: channels });
    }

    send(data: any): void {
        this.#ws?.send(JSON.stringify(data));
    }

    addEventListener(type: string, listener: (...args: any[]) => void): void {
        this.#ws?.addEventListener(type, listener as any);
    }

    removeEventListener(type: string, listener: (...args: any[]) => void): void {
        this.#ws?.removeEventListener(type, listener as any);
    }
}
