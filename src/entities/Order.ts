import type { Instrument } from './Instrument';

export class Order {
    id: string;
    instrument: Instrument;
    price: number;
    size: number;

    constructor(id: string, { instrument, price, size }: Omit<Order, 'id'>) {
        this.id = id;

        this.instrument = instrument;
        this.price = price;
        this.size = size;
    }
}
