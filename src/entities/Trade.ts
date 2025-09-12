import type { Side } from '../types';
import type { Instrument } from './Instrument';

export class Trade {
    id: string;
    instrument: Instrument;
    price: number;
    size: number;
    timestamp: Date;

    constructor(id: string, { instrument, price, size, timestamp }: Omit<Trade, 'id'>) {
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
