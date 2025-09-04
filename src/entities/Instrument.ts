import type { Order } from './Order';
import type { Trade } from './Trade';

export class Instrument {
    #symbol: string;
    #orders: Order[] = [];
    #trades: Trade[] = [];

    constructor(symbol: string) {
        this.#symbol = symbol;
    }

    get symbol() {
        return this.#symbol;
    }

    get orders(): Order[] {
        return this.#orders;
    }

    set orders(value: Order[]) {
        this.#orders = value;
    }

    get trades(): Trade[] {
        return this.#trades;
    }

    set trades(value: Trade[]) {
        this.#trades = value;
    }
}
