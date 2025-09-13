import type { Instrument } from './Instrument';

type OrderBookLevel = {
    price: number;
    size: number;
};

export class OrderBook {
    instrument: Instrument;
    bids: OrderBookLevel[] = [];
    asks: OrderBookLevel[] = [];

    constructor(instrument: Instrument) {
        this.instrument = instrument;
    }
}
