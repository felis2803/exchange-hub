import type { Instrument } from './Instrument';

export class Position {
    instrument: Instrument;
    size: number;
    liquidation = NaN;

    constructor(instrument: Instrument, { size }: Omit<Position, 'instrument'>) {
        this.instrument = instrument;
        this.size = size;
    }
}
