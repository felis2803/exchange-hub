import type { ExchangeHub } from '../ExchangeHub';
import type { EntityClass } from './createEntity';

type OrderBookLevel = {
    price: number;
    size: number;
};

export const createOrderBook = (hub: ExchangeHub<any>, Entity: EntityClass) => {
    class OrderBook extends Entity {
        static hub = hub;
        instrument: any;
        bids: OrderBookLevel[] = [];
        asks: OrderBookLevel[] = [];

        constructor(instrument: any) {
            super();
            this.instrument = instrument;
        }
    }

    return OrderBook;
};

export type OrderBookClass = ReturnType<typeof createOrderBook>;
export type OrderBook = InstanceType<OrderBookClass>;
