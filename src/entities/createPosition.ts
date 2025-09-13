import type { ExchangeHub } from '../ExchangeHub';
import type { ExchangeName, Side } from '../types';
import type { EntityClass } from './createEntity';
import type { Instrument } from './createInstrument';

export function createPosition<ExName extends ExchangeName>(hub: ExchangeHub<ExName>, Entity: EntityClass<ExName>) {
    class Position extends Entity {
        static hub = hub;

        instrument: Instrument<ExName>;
        price: number;
        size: number;
        liquidation = NaN;

        constructor(instrument: Instrument<ExName>, { price, size }: { price: number; size: number }) {
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
}

export type PositionClass<ExName extends ExchangeName> = ReturnType<typeof createPosition<ExName>>;
export type Position<ExName extends ExchangeName> = InstanceType<PositionClass<ExName>>;
