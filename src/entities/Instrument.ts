import { Asset } from './Asset';

export class Instrument {
    constructor(
        public baseAsset: Asset,
        public quoteAsset: Asset,
    ) {}
}
