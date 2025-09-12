import { Book } from './Book';

import type { Trade } from './Trade';
import type { Order } from './Order';
import type { Asset } from './Asset';

export class Instrument {
    symbol: string;
    baseAsset: Asset;
    quoteAsset: Asset;
    trades: Trade[] = [];
    book: Book = new Book(this);
    orders: Order[] = [];

    constructor(symbol: string, { baseAsset, quoteAsset }: Omit<Instrument, 'symbol'>) {
        this.symbol = symbol;

        this.baseAsset = baseAsset;
        this.quoteAsset = quoteAsset;
    }
}
