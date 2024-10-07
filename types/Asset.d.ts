// Asset.d.ts
import { IEntity } from './Entity';

export type AssetSymbol = string;
export type AssetName = string;

export interface IAsset extends IEntity {
    symbol: AssetSymbol;
    name: AssetName;

    // Дополнительные свойства и методы по необходимости
}
