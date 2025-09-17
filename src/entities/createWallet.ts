import type { ExchangeHub } from '../ExchangeHub.js';
import type { EntityClass } from './createEntity.js';
import type { Asset } from './createAsset.js';
import type { ExchangeName } from '../types.js';

export function createWallet<ExName extends ExchangeName>(
  eh: ExchangeHub<ExName>,
  Entity: EntityClass<ExName>,
) {
  class Wallet extends Entity {
    static eh = eh;

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
