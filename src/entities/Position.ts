import { Instrument } from './Instrument';

export class Position {
    constructor(
        public instrument: Instrument,
        public entryPrice: number,
        public quantity: number,
    ) {}
}
