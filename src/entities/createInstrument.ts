import type { ExchangeHub } from '../ExchangeHub';
import type { EntityClass } from './createEntity';
import type { AssetClass } from './createAsset';
import type { OrderBookClass } from './createOrderBook';

export const createInstrument = (hub: ExchangeHub<any>, Entity: EntityClass, OrderBook: OrderBookClass) => {
    class Instrument extends Entity {
        static hub = hub;
        symbol: string;
        baseAsset: InstanceType<AssetClass>;
        quoteAsset: InstanceType<AssetClass>;
        trades: any[] = [];
        bid = NaN;
        ask = NaN;
        orderBook: InstanceType<OrderBookClass>;
        orders: any[] = [];

        constructor(
            symbol: string,
            { baseAsset, quoteAsset }: { baseAsset: InstanceType<AssetClass>; quoteAsset: InstanceType<AssetClass> },
        ) {
            super();
            this.symbol = symbol;
            this.baseAsset = baseAsset;
            this.quoteAsset = quoteAsset;
            this.orderBook = new OrderBook(this);
        }
    }

    return Instrument;
};

export type InstrumentClass = ReturnType<typeof createInstrument>;
export type Instrument = InstanceType<InstrumentClass>;
