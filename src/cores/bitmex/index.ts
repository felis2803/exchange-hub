import { BaseCore } from '../BaseCore';
import { Instrument, Order } from '../../entities';

type RawInstrument = { symbol: string };

export class BitMex extends BaseCore {
    #restEndpoint: string;
    #wsEndpoint: string;
    #ws?: WebSocket;

    constructor(shell: any, settings: any) {
        super(shell, settings);
        this.#restEndpoint = this.isTest ? 'https://testnet.bitmex.com' : 'https://www.bitmex.com';
        this.#wsEndpoint = this.isTest ? 'wss://testnet.bitmex.com/realtime' : 'wss://www.bitmex.com/realtime';
    }

    async connect(): Promise<void> {
        this.#ws = new WebSocket(this.#wsEndpoint);

        await new Promise<void>((resolve, reject) => {
            this.#ws?.addEventListener('open', () => resolve());
            this.#ws?.addEventListener('error', err => reject(err));
        });
    }

    async disconnect(): Promise<void> {
        if (!this.#ws) return;

        await new Promise<void>(resolve => {
            this.#ws?.addEventListener('close', () => resolve());
            this.#ws?.close();
        });

        this.#ws = undefined;
    }

    async getInstruments(): Promise<Instrument[]> {
        const response = await fetch(`${this.#restEndpoint}/api/v1/instrument/active`);
        const data = (await response.json()) as RawInstrument[];

        return data.map(item => new Instrument(item.symbol));
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
}
