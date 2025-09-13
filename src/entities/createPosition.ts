import type { ExchangeHub } from '../ExchangeHub';
import type { Side } from '../types';
import type { EntityClass } from './createEntity';
import type { InstrumentClass } from './createInstrument';

export const createPosition = (hub: ExchangeHub<any>, Entity: EntityClass) => {
    class Position extends Entity {
        static hub = hub;
        instrument: InstanceType<InstrumentClass>;
        price: number;
        size: number;
        liquidation = NaN;

        constructor(instrument: InstanceType<InstrumentClass>, { price, size }: { price: number; size: number }) {
            super();
            this.instrument = instrument;
            this.price = price;
            this.size = size;
        }

        get side(): Side {
            return this.size > 0 ? 'buy' : 'sell';
        }
    }

    return Position;
};

export type PositionClass = ReturnType<typeof createPosition>;
export type Position = InstanceType<PositionClass>;
