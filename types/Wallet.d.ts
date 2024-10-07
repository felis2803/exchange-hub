// Wallet.d.ts
import { IEntity } from './Entity';
import { AssetSymbol } from './Asset';
import { IAsset } from './Asset';
import { IEntityMap } from './EntityMap';

export type Balance = number;

export interface IWallet extends IEntity {
    assets: IEntityMap<AssetSymbol, IAsset>;

    getBalance(assetSymbol: AssetSymbol): Balance;

    // Дополнительные свойства и методы по необходимости
}
