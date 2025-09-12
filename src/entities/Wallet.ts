import type { Asset } from './Asset';

export class Wallet {
    asset: Asset;
    balance: number;

    constructor(asset: Asset, { balance }: Omit<Wallet, 'asset'>) {
        this.asset = asset;

        this.balance = balance;
    }
}
