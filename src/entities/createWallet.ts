import type { EntityClass } from './createEntity';
import type { Asset } from './createAssets';
import type { ExchangeName } from '../types';

export function createWallet<ExName extends ExchangeName>(Entity: EntityClass<ExName>) {
    class Wallet extends Entity {
        asset: Asset<ExName>;
        balance: number;

        constructor(asset: Asset<ExName>, { balance }: { balance: number }) {
            super();

            this.asset = asset;
            this.balance = balance;
        }
    }

    return Wallet;
}

export type WalletClass<ExName extends ExchangeName> = ReturnType<typeof createWallet<ExName>>;
export type Wallet<ExName extends ExchangeName> = InstanceType<WalletClass<ExName>>;
