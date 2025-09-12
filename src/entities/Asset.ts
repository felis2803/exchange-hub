import type { Instrument } from './Instrument';

export class Asset {
    symbol: string;
    instruments: Instrument[] = [];
    baseFor: Instrument[] = [];
    quoteFor: Instrument[] = [];

    constructor(symbol: string) {
        this.symbol = symbol;
    }
}
