import type { Instrument } from './Instrument';

export type OrderSide = 'Buy' | 'Sell';

export class Order {
    #instrument: Instrument;
    #id: number;
    #side: OrderSide;
    #price: number;
    #size: number;

    constructor(instrument: Instrument, data: { id: number; side: OrderSide; price: number; size: number }) {
        this.#instrument = instrument;
        this.#id = data.id;
        this.#side = data.side;
        this.#price = data.price;
        this.#size = data.size;
    }

    get instrument(): Instrument {
        return this.#instrument;
    }

    get symbol(): string {
        return this.#instrument.symbol;
    }

    get id(): number {
        return this.#id;
    }

    get side(): OrderSide {
        return this.#side;
    }

    get price(): number {
        return this.#price;
    }

    get size(): number {
        return this.#size;
    }
}
