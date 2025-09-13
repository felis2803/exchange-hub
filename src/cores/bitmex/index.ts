import { BITMEX_PRIVATE_CHANNELS, BITMEX_PUBLIC_CHANNELS } from './constants';
import { BitMexTransport } from './transport';

import type {
    BitMexInstrument,
    BitMexTrade,
    InstrumentMessage,
    TradeMessage,
    SubscribeMessage,
    WelcomeMessage,
    FundingMessage,
    LiquidationMessage,
    OrderBookL2Message,
    SettlementMessage,
    ExecutionMessage,
    OrderMessage,
    MarginMessage,
    PositionMessage,
    TransactMessage,
    WalletMessage,
    BitMexChannel,
    BitMexChannelMessageMap,
} from './types';
import { BaseCore } from '../BaseCore';
import { Asset, Instrument, Order, Trade } from '../../entities';

export class BitMex extends BaseCore {
    #wsEndpoint: string;
    #transport: BitMexTransport;
    #instruments: Map<string, BitMexInstrument> = new Map();
    #instrumentEntities: Map<string, Instrument> = new Map();
    #assetEntities: Map<string, Asset> = new Map();
    #instrumentReady!: Promise<void>;
    #resolveInstrumentReady!: () => void;
    #channelHandlers: {
        [K in BitMexChannel]: (message: BitMexChannelMessageMap[K]) => void;
    };
    #partials: Set<BitMexChannel> = new Set();

    constructor(shell: any, settings: any) {
        super(shell, settings);
        this.#wsEndpoint = this.isTest ? 'wss://testnet.bitmex.com/realtime' : 'wss://www.bitmex.com/realtime';
        this.#transport = new BitMexTransport(this.#wsEndpoint);
        this.#channelHandlers = {
            instrument: this.#handleInstrumentMessage,
            trade: this.#handleTradeMessage,
            funding: this.#handleFundingMessage,
            liquidation: this.#handleLiquidationMessage,
            orderBookL2: this.#handleOrderBookL2Message,
            settlement: this.#handleSettlementMessage,
            execution: this.#handleExecutionMessage,
            order: this.#handleOrderMessage,
            margin: this.#handleMarginMessage,
            position: this.#handlePositionMessage,
            transact: this.#handleTransactMessage,
            wallet: this.#handleWalletMessage,
        };
    }

    async connect(): Promise<void> {
        await this.#transport.connect(this.isPublicOnly, this.apiKey, this.apiSec);

        this.#instrumentReady = new Promise(resolve => {
            this.#resolveInstrumentReady = resolve;
        });

        this.#partials.clear();
        this.#transport.addEventListener('message', this.#handleMessage);

        const channels = (
            this.isPublicOnly ? BITMEX_PUBLIC_CHANNELS : [...BITMEX_PUBLIC_CHANNELS, ...BITMEX_PRIVATE_CHANNELS]
        ) as BitMexChannel[];

        this.#transport.subscribe(channels);
    }

    async disconnect(): Promise<void> {
        if (!this.#transport.isConnected()) return;

        this.#transport.removeEventListener('message', this.#handleMessage);
        await this.#transport.disconnect();

        this.#instruments.clear();
        this.#instrumentEntities.clear();
        this.#assetEntities.clear();
        this.#partials.clear();
    }

    async getInstruments(): Promise<Instrument[]> {
        await this.#instrumentReady;

        const instruments: Instrument[] = [];

        this.#instrumentEntities.clear();

        for (const item of this.#instruments.values()) {
            const baseAsset = this.#getOrCreateAsset(item.underlying || item.rootSymbol || '');
            const quoteAsset = this.#getOrCreateAsset(item.quoteCurrency || item.settlCurrency || '');
            const inst = new Instrument(item.symbol, { baseAsset, quoteAsset } as Omit<Instrument, 'symbol'>);

            instruments.push(inst);
            this.#instrumentEntities.set(inst.symbol, inst);
        }

        return instruments;
    }

    async getOrders(instrument: Instrument): Promise<Order[]> {
        if (!this.#transport.isConnected()) throw new Error('WebSocket not connected');

        const channel = `orderBook10:${instrument.symbol}`;

        this.#transport.send({ op: 'subscribe', args: [channel] });

        return new Promise<Order[]>((resolve, reject) => {
            const handleMessage = (event: MessageEvent) => {
                try {
                    const text = typeof event.data === 'string' ? event.data : '';
                    const message = JSON.parse(text);

                    if (message.table === 'orderBook10' && Array.isArray(message.data)) {
                        const row = message.data.find((d: any) => d.symbol === instrument.symbol);

                        if (!row) return;

                        this.#transport.removeEventListener('message', handleMessage);
                        this.#transport.send({ op: 'unsubscribe', args: [channel] });

                        const orders: Order[] = [];

                        if (row.bids?.length) {
                            orders.push(
                                new Order('bid', {
                                    instrument,
                                    price: row.bids[0][0],
                                    size: row.bids[0][1],
                                }),
                            );
                        }

                        if (row.asks?.length) {
                            orders.push(
                                new Order('ask', {
                                    instrument,
                                    price: row.asks[0][0],
                                    size: -row.asks[0][1],
                                }),
                            );
                        }

                        resolve(orders);
                    }
                } catch (err) {
                    this.#transport.removeEventListener('message', handleMessage);
                    reject(err);
                }
            };

            this.#transport.addEventListener('message', handleMessage);
            this.#transport.addEventListener('error', reject as any);
        });
    }

    #getOrCreateAsset(symbol: string): Asset {
        let asset = this.#assetEntities.get(symbol);

        if (!asset) {
            asset = new Asset(symbol);
            this.#assetEntities.set(symbol, asset);
        }

        return asset;
    }

    #handleMessage = (event: MessageEvent) => {
        try {
            const text = typeof event.data === 'string' ? event.data : '';

            if (!text) return;

            const message = JSON.parse(text) as BitMexChannelMessageMap[BitMexChannel];

            if (this.#isWelcomeMessage(message) || this.#isSubscribeMessage(message)) return;

            const { table, action } = message as { table?: BitMexChannel; action?: string };

            if (!table) return;

            if (action === 'partial') {
                this.#partials.add(table);
            } else if (!this.#partials.has(table)) {
                return;
            }

            const handler = this.#channelHandlers[table] as (msg: BitMexChannelMessageMap[BitMexChannel]) => void;

            handler?.(message as BitMexChannelMessageMap[BitMexChannel]);
        } catch {
            // ignore
        }
    };

    #handleTradeMessage = (message: TradeMessage) => {
        for (const data of message.data) {
            const item: BitMexTrade = { ...data };
            const instrument = this.#instrumentEntities.get(item.symbol);

            if (!instrument) continue;

            const size = item.side === 'Buy' ? item.size : -item.size;
            const trade = new Trade(item.trdMatchID, {
                instrument,
                price: item.price,
                size,
                timestamp: new Date(item.timestamp),
            } as Omit<Trade, 'id'>);

            instrument.trades = [...instrument.trades, trade];
        }
    };

    #handleFundingMessage = (_message: FundingMessage) => {
        // noop
    };

    #handleLiquidationMessage = (_message: LiquidationMessage) => {
        // noop
    };

    #handleOrderBookL2Message = (_message: OrderBookL2Message) => {
        // noop
    };

    #handleSettlementMessage = (_message: SettlementMessage) => {
        // noop
    };

    #handleExecutionMessage = (_message: ExecutionMessage) => {
        // noop
    };

    #handleOrderMessage = (_message: OrderMessage) => {
        // noop
    };

    #handleMarginMessage = (_message: MarginMessage) => {
        // noop
    };

    #handlePositionMessage = (_message: PositionMessage) => {
        // noop
    };

    #handleTransactMessage = (_message: TransactMessage) => {
        // noop
    };

    #handleWalletMessage = (_message: WalletMessage) => {
        // noop
    };

    #handleInstrumentMessage = (message: InstrumentMessage) => {
        switch (message.action) {
            case 'partial':
                this.#instruments.clear();

                for (const d of message.data as BitMexInstrument[]) {
                    this.#instruments.set(d.symbol, { ...d });
                }

                this.#resolveInstrumentReady?.();
                break;
            case 'insert':
                for (const item of message.data as BitMexInstrument[]) {
                    this.#instruments.set(item.symbol, { ...item });
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
                        this.#instruments.set(item.symbol, { ...item });
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
