import type { Instrument } from './Instrument';
import type { OrderSide } from './Order';

export class Trade {
    #instrument: Instrument;
    #id: string;
    #side: OrderSide;
    #price: number;
    #size: number;
    #timestamp: Date;

    constructor(
        instrument: Instrument,
        data: { id: string; side: OrderSide; price: number; size: number; timestamp: string | Date },
    ) {
        this.#instrument = instrument;
        this.#id = data.id;
        this.#side = data.side;
        this.#price = data.price;
        this.#size = data.size;
        this.#timestamp = typeof data.timestamp === 'string' ? new Date(data.timestamp) : data.timestamp;
    }

    get instrument(): Instrument {
        return this.#instrument;
    }

    get symbol(): string {
        return this.#instrument.symbol;
    }

    get id(): string {
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

    get timestamp(): Date {
        return this.#timestamp;
    }
}
