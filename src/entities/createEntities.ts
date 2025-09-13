import type { Side } from '../types';
import type { ExchangeHub } from '../ExchangeHub';

export const createEntities = (hub: ExchangeHub<any>) => {
    class Entity {
        static hub = hub;
    }

    class Asset extends Entity {
        static hub = hub;
        symbol: string;
        instruments: Instrument[] = [];
        baseFor: Instrument[] = [];
        quoteFor: Instrument[] = [];

        constructor(symbol: string) {
            super();
            this.symbol = symbol;
        }
    }

    type OrderBookLevel = {
        price: number;
        size: number;
    };

    class OrderBook extends Entity {
        static hub = hub;
        instrument: Instrument;
        bids: OrderBookLevel[] = [];
        asks: OrderBookLevel[] = [];

        constructor(instrument: Instrument) {
            super();
            this.instrument = instrument;
        }
    }

    class Instrument extends Entity {
        static hub = hub;
        symbol: string;
        baseAsset: Asset;
        quoteAsset: Asset;
        trades: Trade[] = [];
        bid = NaN;
        ask = NaN;
        orderBook: OrderBook;
        orders: Order[] = [];

        constructor(symbol: string, { baseAsset, quoteAsset }: Omit<Instrument, 'symbol'>) {
            super();
            this.symbol = symbol;
            this.baseAsset = baseAsset;
            this.quoteAsset = quoteAsset;
            this.orderBook = new OrderBook(this);
        }
    }

    class Order extends Entity {
        static hub = hub;
        id: string;
        instrument: Instrument;
        price: number;
        size: number;

        constructor(id: string, { instrument, price, size }: Omit<Order, 'id'>) {
            super();
            this.id = id;
            this.instrument = instrument;
            this.price = price;
            this.size = size;
        }
    }

    class Trade extends Entity {
        static hub = hub;
        id: string;
        instrument: Instrument;
        price: number;
        size: number;
        timestamp: Date;

        constructor(id: string, { instrument, price, size, timestamp }: Omit<Trade, 'id'>) {
            super();
            this.id = id;
            this.instrument = instrument;
            this.price = price;
            this.size = size;
            this.timestamp = timestamp;
        }

        get side(): Side {
            return this.size > 0 ? 'buy' : 'sell';
        }
    }

    class Wallet extends Entity {
        static hub = hub;
        asset: Asset;
        balance: number;

        constructor(asset: Asset, { balance }: Omit<Wallet, 'asset'>) {
            super();
            this.asset = asset;
            this.balance = balance;
        }
    }

    class Position extends Entity {
        static hub = hub;
        instrument: Instrument;
        price: number;
        size: number;
        liquidation = NaN;

        constructor(instrument: Instrument, { price, size }: Omit<Position, 'instrument'>) {
            super();
            this.instrument = instrument;
            this.price = price;
            this.size = size;
        }

        get side(): Side {
            return this.size > 0 ? 'buy' : 'sell';
        }
    }

    return { Entity, Asset, OrderBook, Instrument, Order, Trade, Wallet, Position };
};

export type Entities = ReturnType<typeof createEntities>;
export type EntityClass = Entities['Entity'];
export type Asset = InstanceType<Entities['Asset']>;
export type Instrument = InstanceType<Entities['Instrument']>;
export type OrderBook = InstanceType<Entities['OrderBook']>;
export type Order = InstanceType<Entities['Order']>;
export type Trade = InstanceType<Entities['Trade']>;
export type Wallet = InstanceType<Entities['Wallet']>;
export type Position = InstanceType<Entities['Position']>;
