import type { Order } from './Order';

export class Instrument {
    #symbol: string;
    #orders: Order[] = [];

    constructor(symbol: string) {
        this.#symbol = symbol;
    }

    get symbol() {
        return this.#symbol;
    }

    get orders(): Order[] {
        return this.#orders;
    }
}
