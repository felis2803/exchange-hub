import type { ExchangeHub } from '../ExchangeHub';
import type { Side } from '../types';
import type { EntityClass } from './createEntity';
import type { InstrumentClass } from './createInstrument';

export const createTrade = (hub: ExchangeHub<any>, Entity: EntityClass) => {
    class Trade extends Entity {
        static hub = hub;
        id: string;
        instrument: InstanceType<InstrumentClass>;
        price: number;
        size: number;
        timestamp: Date;

        constructor(
            id: string,
            {
                instrument,
                price,
                size,
                timestamp,
            }: {
                instrument: InstanceType<InstrumentClass>;
                price: number;
                size: number;
                timestamp: Date;
            },
        ) {
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

    return Trade;
};

export type TradeClass = ReturnType<typeof createTrade>;
export type Trade = InstanceType<TradeClass>;
