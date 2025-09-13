import type { ExchangeHub } from '../ExchangeHub';
import type { EntityClass } from './createEntity';
import type { AssetClass } from './createAsset';

export const createWallet = (hub: ExchangeHub<any>, Entity: EntityClass) => {
    class Wallet extends Entity {
        static hub = hub;
        asset: InstanceType<AssetClass>;
        balance: number;

        constructor(asset: InstanceType<AssetClass>, { balance }: { balance: number }) {
            super();
            this.asset = asset;
            this.balance = balance;
        }
    }

    return Wallet;
};

export type WalletClass = ReturnType<typeof createWallet>;
export type Wallet = InstanceType<WalletClass>;
