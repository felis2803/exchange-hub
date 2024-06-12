import { Asset } from './Asset';

export class Wallet {
    constructor(
        public asset: Asset,
        public balance: number,
    ) {}
}
