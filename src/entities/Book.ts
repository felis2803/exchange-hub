import type { Instrument } from './Instrument';

type BookLevel = {
    price: number;
    size: number;
};

export class Book {
    instrument: Instrument;
    bids: BookLevel[] = [];
    asks: BookLevel[] = [];

    constructor(instrument: Instrument) {
        this.instrument = instrument;
    }
}
