import type { Instrument } from './Instrument';

export class Order {
    #instrument: Instrument;

    constructor(instrument: Instrument) {
        this.#instrument = instrument;
    }

    get instrument(): Instrument {
        return this.#instrument;
    }

    get symbol(): string {
        return this.#instrument.symbol;
    }
}
