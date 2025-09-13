import { createHmac } from 'crypto';

import { isSubscribeMessage, isTableMessage, isWelcomeMessage } from './utils';
import { tableMessageHandlers } from './tableMessageHandlers';

import type { BitMex } from '.';
import type { BitMexChannel, BitMexSubscribeMessage } from './types';

export class BitMexTransport {
    #core: BitMex;
    #wsEndpoint: string;
    #ws: WebSocket;

    constructor(core: BitMex, isTest: boolean) {
        this.#core = core;

        this.#wsEndpoint = isTest ? 'wss://testnet.bitmex.com/realtime' : 'wss://www.bitmex.com/realtime';
        this.#ws = new WebSocket(this.#wsEndpoint);

        this.#ws.onmessage = (event: MessageEvent) => this.#handleMessage(event);
    }

    #handleMessage(event: MessageEvent) {
        const text = typeof event.data === 'string' ? event.data : '';

        if (!text) {
            return;
        }

        const message = JSON.parse(text);

        if (isWelcomeMessage(message)) {
            return;
        }

        if (isSubscribeMessage(message)) {
            return this.#handleSubscribeMessage(message);
        }

        if (!isTableMessage(message)) {
            console.log(message);

            throw new Error('Unknown message');
        }

        const { table, action, data } = message;

        tableMessageHandlers[table][action](this.#core, data);
    }

    #handleSubscribeMessage(message: BitMexSubscribeMessage) {
        throw 'not implemented';
    }

    async connect(apiKey?: string, apiSec?: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.#ws?.addEventListener('open', () => resolve());
            this.#ws?.addEventListener('error', err => reject(err));
        });

        if (apiKey && apiSec) {
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
