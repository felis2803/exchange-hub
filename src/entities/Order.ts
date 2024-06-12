import { Instrument } from './Instrument';

export class Order {
    constructor(
        public id: string,
        public instrument: Instrument,
        public type: 'buy' | 'sell',
        public price: number,
        public quantity: number,
    ) {}
}
