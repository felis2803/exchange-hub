import { createHmac } from 'crypto';

import { isSubscribeMessage, isChannelMessage, isWelcomeMessage } from './utils';
import { channelMessageHandlers } from './channelMessageHandlers';
import { BITMEX_WS_ENDPOINTS, BITMEX_REST_ENDPOINTS } from './constants';

import type { BitMex } from '.';
import type {
    BitMexChannel,
    BitMexSubscribeMessage,
    BitMexWelcomeMessage,
    BitMexChannelMessage,
    BitMexPlaceOrderRequest,
    BitMexChangeOrderRequest,
    BitMexOrder,
    BitMexRequestVerb,
} from './types';

export class BitMexTransport {
    #core: BitMex;
    #wsEndpoint: string;
    #ws: WebSocket;
    #restEndpoint: string;
    #apiKey?: string;
    #apiSec?: string;

    constructor(core: BitMex, isTest: boolean) {
        this.#core = core;

        this.#wsEndpoint = isTest ? BITMEX_WS_ENDPOINTS.testnet : BITMEX_WS_ENDPOINTS.mainnet;
        this.#restEndpoint = isTest ? BITMEX_REST_ENDPOINTS.testnet : BITMEX_REST_ENDPOINTS.mainnet;
        this.#ws = new WebSocket(this.#wsEndpoint);

        this.#ws.onmessage = (event: MessageEvent) => this.#handleMessage(event);
    }

    #handleMessage(event: MessageEvent) {
        const text = typeof event.data === 'string' ? event.data : '';

        if (!text) {
            return;
        }

        const message = JSON.parse(text);

        if (isChannelMessage(message)) {
            this.#handleChannelMessage(message);
        }

        if (isSubscribeMessage(message)) {
            return this.#handleSubscribeMessage(message);
        }

        if (isWelcomeMessage(message)) {
            return this.#handleWelcomeMessage(message);
        }

        console.log(message);

        throw new Error('Unknown message');
    }

    #handleWelcomeMessage(_message: BitMexWelcomeMessage) {
        throw 'not implemented';
    }

    #handleSubscribeMessage(_message: BitMexSubscribeMessage) {
        throw 'not implemented';
    }

    #handleChannelMessage<Channel extends BitMexChannel>(message: BitMexChannelMessage<Channel>) {
        const { table, action, data } = message;

        channelMessageHandlers[table][action](this.#core, data);
    }

    async connect(apiKey?: string, apiSec?: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.#ws?.addEventListener('open', () => resolve());
            this.#ws?.addEventListener('error', err => reject(err));
        });

        if (apiKey && apiSec) {
            this.#apiKey = apiKey;
            this.#apiSec = apiSec;

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

    async placeOrder(order: BitMexPlaceOrderRequest): Promise<BitMexOrder> {
        return this.#request<BitMexOrder>('POST', '/order', order);
    }

    async changeOrder(order: BitMexChangeOrderRequest): Promise<BitMexOrder> {
        return this.#request<BitMexOrder>('PUT', '/order', order);
    }

    async deleteOrder(orderID: string): Promise<BitMexOrder[]> {
        const path = `/order?orderID=${orderID}`;

        return this.#request<BitMexOrder[]>('DELETE', path);
    }

    async #request<T>(verb: BitMexRequestVerb, path: string, body?: unknown): Promise<T> {
        if (!this.#apiKey || !this.#apiSec) {
            throw new Error('API credentials required');
        }

        const expires = Math.round(Date.now() / 1000) + 60;
        const bodyText = body ? JSON.stringify(body) : '';
        const signedPath = `/api/v1${path}`;
        const signature = createHmac('sha256', this.#apiSec)
            .update(`${verb}${signedPath}${expires}${bodyText}`)
            .digest('hex');

        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'api-key': this.#apiKey,
            'api-expires': expires.toString(),
            'api-signature': signature,
        };

        const res = await fetch(`${this.#restEndpoint}${path}`, {
            method: verb,
            headers,
            body: bodyText || undefined,
        });

        if (!res.ok) {
            throw new Error(`BitMex request failed: ${res.status} ${res.statusText}`);
        }

        return res.json() as Promise<T>;
    }

    send(data: any): void {
        this.#ws?.send(JSON.stringify(data));
    }
}
