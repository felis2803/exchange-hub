import type { Side } from '../types';
import type { Instrument } from './Instrument';

export class Position {
    instrument: Instrument;
    price: number;
    size: number;
    liquidation = NaN;

    constructor(instrument: Instrument, { price, size }: Omit<Position, 'instrument'>) {
        this.instrument = instrument;
        this.price = price;
        this.size = size;
    }

    get side(): Side {
        return this.size > 0 ? 'buy' : 'sell';
    }
}
