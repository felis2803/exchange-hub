import { createHmac } from 'crypto';

import { BitMexInstrument } from './BitMexInstrument';
import { BitMexTrade } from './BitMexTrade';

import type { InstrumentMessage, TradeMessage, SubscribeMessage, WelcomeMessage } from './types';
import { BaseCore } from '../BaseCore';
import { Instrument, Order, Trade } from '../../entities';

export class BitMex extends BaseCore {
    #wsEndpoint: string;
    #ws?: WebSocket;
    #instruments: Map<string, BitMexInstrument> = new Map();
    #instrumentEntities: Map<string, Instrument> = new Map();
    #instrumentReady!: Promise<void>;
    #resolveInstrumentReady!: () => void;
    #channelHandlers: Record<string, (message: any) => void>;

    constructor(shell: any, settings: any) {
        super(shell, settings);
        this.#wsEndpoint = this.isTest ? 'wss://testnet.bitmex.com/realtime' : 'wss://www.bitmex.com/realtime';
        this.#channelHandlers = {
            instrument: this.#handleInstrumentMessage,
            trade: this.#handleTradeMessage,
        };
    }

    async connect(): Promise<void> {
        this.#ws = new WebSocket(this.#wsEndpoint);

        await new Promise<void>((resolve, reject) => {
            this.#ws?.addEventListener('open', () => resolve());
            this.#ws?.addEventListener('error', err => reject(err));
        });

        if (!this.isPublicOnly && this.apiKey && this.apiSec) {
            const expires = Math.round(Date.now() / 1000) + 60;
            const signature = createHmac('sha256', this.apiSec).update(`GET/realtime${expires}`).digest('hex');

            this.#ws.send(
                JSON.stringify({
                    op: 'authKeyExpires',
                    args: [this.apiKey, expires, signature],
                }),
            );
        }

        this.#instrumentReady = new Promise(resolve => {
            this.#resolveInstrumentReady = resolve;
        });

        this.#ws.addEventListener('message', this.#handleMessage);
        this.#ws.send(JSON.stringify({ op: 'subscribe', args: ['instrument', 'trade'] }));
    }

    async disconnect(): Promise<void> {
        if (!this.#ws) return;

        await new Promise<void>(resolve => {
            this.#ws?.addEventListener('close', () => resolve());
            this.#ws?.close();
        });

        this.#ws.removeEventListener('message', this.#handleMessage);
        this.#ws = undefined;
        this.#instruments.clear();
        this.#instrumentEntities.clear();
    }

    async getInstruments(): Promise<Instrument[]> {
        await this.#instrumentReady;

        const instruments = Array.from(this.#instruments.values()).map(i => new Instrument(i.symbol));

        this.#instrumentEntities.clear();

        for (const inst of instruments) {
            this.#instrumentEntities.set(inst.symbol, inst);
        }

        return instruments;
    }

    async getOrders(instrument: Instrument): Promise<Order[]> {
        if (!this.#ws) throw new Error('WebSocket not connected');

        const channel = `orderBook10:${instrument.symbol}`;

        this.#ws.send(JSON.stringify({ op: 'subscribe', args: [channel] }));

        return new Promise<Order[]>((resolve, reject) => {
            const handleMessage = (event: MessageEvent) => {
                try {
                    const text = typeof event.data === 'string' ? event.data : '';
                    const message = JSON.parse(text);

                    if (message.table === 'orderBook10' && Array.isArray(message.data)) {
                        const row = message.data.find((d: any) => d.symbol === instrument.symbol);

                        if (!row) return;

                        this.#ws?.removeEventListener('message', handleMessage);
                        this.#ws?.send(JSON.stringify({ op: 'unsubscribe', args: [channel] }));

                        const orders: Order[] = [];

                        if (row.bids?.length) {
                            orders.push(
                                new Order(instrument, {
                                    id: 0,
                                    side: 'Buy',
                                    price: row.bids[0][0],
                                    size: row.bids[0][1],
                                }),
                            );
                        }

                        if (row.asks?.length) {
                            orders.push(
                                new Order(instrument, {
                                    id: 0,
                                    side: 'Sell',
                                    price: row.asks[0][0],
                                    size: row.asks[0][1],
                                }),
                            );
                        }

                        resolve(orders);
                    }
                } catch (err) {
                    this.#ws?.removeEventListener('message', handleMessage);
                    reject(err);
                }
            };

            this.#ws?.addEventListener('message', handleMessage);
            this.#ws?.addEventListener('error', reject);
        });
    }

    #handleMessage = (event: MessageEvent) => {
        try {
            const text = typeof event.data === 'string' ? event.data : '';

            if (!text) return;

            const message = JSON.parse(text);

            if (this.#isWelcomeMessage(message) || this.#isSubscribeMessage(message)) return;

            const table = (message as { table?: string }).table;

            if (!table) return;

            const handler = this.#channelHandlers[table];

            handler?.(message);
        } catch {
            // ignore
        }
    };

    #handleTradeMessage = (message: TradeMessage) => {
        for (const data of message.data) {
            const item = new BitMexTrade(data);
            const instrument = this.#instrumentEntities.get(item.symbol);

            if (!instrument) continue;

            const trade = new Trade(instrument, {
                id: item.trdMatchID,
                side: item.side,
                price: item.price,
                size: item.size,
                timestamp: item.timestamp,
            });

            instrument.trades = [...instrument.trades, trade];
        }
    };

    #handleInstrumentMessage = (message: InstrumentMessage) => {
        switch (message.action) {
            case 'partial':
                this.#instruments.clear();

                for (const d of message.data as BitMexInstrument[]) {
                    this.#instruments.set(d.symbol, new BitMexInstrument(d));
                }

                this.#resolveInstrumentReady?.();
                break;
            case 'insert':
                for (const item of message.data as BitMexInstrument[]) {
                    this.#instruments.set(item.symbol, new BitMexInstrument(item));
                }

                break;
            case 'delete':
                for (const item of message.data as BitMexInstrument[]) {
                    this.#instruments.delete(item.symbol);
                }

                break;
            case 'update':
                for (const item of message.data as BitMexInstrument[]) {
                    const existing = this.#instruments.get(item.symbol);

                    if (existing) {
                        Object.assign(existing, item);
                    } else {
                        this.#instruments.set(item.symbol, new BitMexInstrument(item));
                    }
                }

                break;
            default:
                break;
        }
    };

    #isWelcomeMessage(message: any): message is WelcomeMessage {
        return typeof message?.info === 'string' && 'version' in message;
    }

    #isSubscribeMessage(message: any): message is SubscribeMessage {
        return typeof message?.success === 'boolean' && 'subscribe' in message;
    }
}
