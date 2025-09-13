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
    #orderBookLevels: Map<string, Map<number, { side: 'Buy' | 'Sell'; price: number; size: number }>> = new Map();
    #orderBookReady!: Promise<void>;
    #resolveOrderBookReady!: () => void;
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
        this.#orderBookReady = new Promise(resolve => {
            this.#resolveOrderBookReady = resolve;
        });

        this.#partials.clear();
        this.#transport.addEventListener('message', this.#handleMessage);

        const channels = (
            this.isPublicOnly ? BITMEX_PUBLIC_CHANNELS : [...BITMEX_PUBLIC_CHANNELS, ...BITMEX_PRIVATE_CHANNELS]
        ) as BitMexChannel[];

        this.#transport.subscribe(channels);

        await Promise.all([this.#instrumentReady, this.#orderBookReady]);
    }

    async disconnect(): Promise<void> {
        if (!this.#transport.isConnected()) return;

        this.#transport.removeEventListener('message', this.#handleMessage);
        await this.#transport.disconnect();

        this.#instruments.clear();
        this.#instrumentEntities.clear();
        this.#assetEntities.clear();
        this.#orderBookLevels.clear();
        this.#partials.clear();
    }

    get instruments(): Instrument[] {
        return [...this.#instrumentEntities.values()];
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

    #handleOrderBookL2Message = (message: OrderBookL2Message) => {
        const grouped: Record<string, typeof message.data> = {};

        for (const row of message.data) {
            (grouped[row.symbol] ??= []).push(row);
        }

        for (const [symbol, rows] of Object.entries(grouped)) {
            let book = this.#orderBookLevels.get(symbol);

            if (message.action === 'partial') {
                book = new Map();
                this.#orderBookLevels.set(symbol, book);
            } else {
                if (!book) {
                    book = new Map();
                    this.#orderBookLevels.set(symbol, book);
                }
            }

            switch (message.action) {
                case 'partial':
                case 'insert':
                    for (const r of rows) {
                        book!.set(r.id, { side: r.side, price: r.price, size: r.size });
                    }
                    break;
                case 'update':
                    for (const r of rows) {
                        const level = book!.get(r.id);
                        if (level) {
                            level.size = r.size ?? level.size;
                            level.price = r.price ?? level.price;
                            level.side = r.side ?? level.side;
                        } else {
                            book!.set(r.id, { side: r.side, price: r.price, size: r.size });
                        }
                    }
                    break;
                case 'delete':
                    for (const r of rows) {
                        book!.delete(r.id);
                    }
                    break;
                default:
                    break;
            }

            this.#updateInstrumentOrderBook(symbol);
        }

        if (message.action === 'partial') {
            this.#resolveOrderBookReady?.();
        }
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
                this.#instrumentEntities.clear();

                for (const d of message.data as BitMexInstrument[]) {
                    this.#instruments.set(d.symbol, { ...d });

                    const baseAsset = this.#getOrCreateAsset(d.underlying || d.rootSymbol || '');
                    const quoteAsset = this.#getOrCreateAsset(d.quoteCurrency || d.settlCurrency || '');
                    const inst = new Instrument(d.symbol, { baseAsset, quoteAsset } as Omit<Instrument, 'symbol'>);

                    this.#instrumentEntities.set(inst.symbol, inst);
                    this.#updateInstrumentOrderBook(d.symbol);
                }

                this.#resolveInstrumentReady?.();
                break;
            case 'insert':
                for (const item of message.data as BitMexInstrument[]) {
                    this.#instruments.set(item.symbol, { ...item });
                    const baseAsset = this.#getOrCreateAsset(item.underlying || item.rootSymbol || '');
                    const quoteAsset = this.#getOrCreateAsset(item.quoteCurrency || item.settlCurrency || '');
                    const inst = new Instrument(item.symbol, { baseAsset, quoteAsset } as Omit<Instrument, 'symbol'>);
                    this.#instrumentEntities.set(inst.symbol, inst);
                    this.#updateInstrumentOrderBook(item.symbol);
                }

                break;
            case 'delete':
                for (const item of message.data as BitMexInstrument[]) {
                    this.#instruments.delete(item.symbol);
                    this.#instrumentEntities.delete(item.symbol);
                    this.#orderBookLevels.delete(item.symbol);
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

                    const inst = this.#instrumentEntities.get(item.symbol);
                    if (inst) {
                        if (item.underlying || item.rootSymbol) {
                            inst.baseAsset = this.#getOrCreateAsset(item.underlying || item.rootSymbol || '');
                        }
                        if (item.quoteCurrency || item.settlCurrency) {
                            inst.quoteAsset = this.#getOrCreateAsset(item.quoteCurrency || item.settlCurrency || '');
                        }
                    } else {
                        const baseAsset = this.#getOrCreateAsset(item.underlying || item.rootSymbol || '');
                        const quoteAsset = this.#getOrCreateAsset(item.quoteCurrency || item.settlCurrency || '');
                        const newInst = new Instrument(item.symbol, { baseAsset, quoteAsset } as Omit<Instrument, 'symbol'>);
                        this.#instrumentEntities.set(newInst.symbol, newInst);
                        this.#updateInstrumentOrderBook(item.symbol);
                    }
                }

                break;
            default:
                break;
        }
    };

    #updateInstrumentOrderBook(symbol: string) {
        const instrument = this.#instrumentEntities.get(symbol);
        const levels = this.#orderBookLevels.get(symbol);

        if (!instrument || !levels) return;

        const bids: { price: number; size: number }[] = [];
        const asks: { price: number; size: number }[] = [];

        for (const level of levels.values()) {
            if (level.side === 'Buy') {
                bids.push({ price: level.price, size: level.size });
            } else {
                asks.push({ price: level.price, size: -level.size });
            }
        }

        bids.sort((a, b) => b.price - a.price);
        asks.sort((a, b) => a.price - b.price);

        instrument.orderBook.bids = bids;
        instrument.orderBook.asks = asks;

        instrument.orders = [];

        if (bids.length) {
            instrument.bid = bids[0].price;
            instrument.orders.push(
                new Order('bid', {
                    instrument,
                    price: bids[0].price,
                    size: bids[0].size,
                }),
            );
        } else {
            instrument.bid = NaN;
        }

        if (asks.length) {
            instrument.ask = asks[0].price;
            instrument.orders.push(
                new Order('ask', {
                    instrument,
                    price: asks[0].price,
                    size: asks[0].size,
                }),
            );
        } else {
            instrument.ask = NaN;
        }
    }

    #isWelcomeMessage(message: any): message is WelcomeMessage {
        return typeof message?.info === 'string' && 'version' in message;
    }

    #isSubscribeMessage(message: any): message is SubscribeMessage {
        return typeof message?.success === 'boolean' && 'subscribe' in message;
    }
}
