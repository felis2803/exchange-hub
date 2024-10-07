// ExchangeHub.d.ts
import { IEntity } from './Entity';
import { IInstrument } from './Instrument';
import { IEntityMap } from './EntityMap';
import { IAsset } from './Asset';
import { IWallet } from './Wallet';
import { IMargin } from './Margin';

export type ExchangeName = string;
export type ApiKey = string;
export type ApiSecret = string;
export type TestNet = boolean;
export type PriceRound = boolean;
export type VolumeRound = boolean;

export interface IExchangeOptions {
    apiKey?: ApiKey;
    apiSecret?: ApiSecret;
    testNet?: TestNet;
    priceRound?: PriceRound;
    volumeRound?: VolumeRound;
}

export interface IExchangeHub extends IEntity {
    connect(): Promise<void>;
    instruments: IEntityMap<string, IInstrument>;
    assets: IEntityMap<string, IAsset>;
    wallets: IEntityMap<string, IWallet>;
    margins: IEntityMap<string, IMargin>;

    // Другие свойства по необходимости
}
