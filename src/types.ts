import type { ASSET_TYPES, INSTRUMENT_STATUSES, INSTRUMENT_TYPES } from './constants';
import type { Cores } from './core/index';

export type ExchangeName = keyof typeof Cores;

export type ApiKey = string;

export type ApiSec = string;

export type Settings = {
    apiKey?: ApiKey;
    apiSec?: ApiSec;
    isTest?: boolean;
    symbolMappingEnabled?: boolean;
};

export type AssetType = (typeof ASSET_TYPES)[number];

export interface IAsset {
    symbol: string;
    type: AssetType;
}

export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export type InstrumentStatus = (typeof INSTRUMENT_STATUSES)[number];

export interface IInstrument {
    symbol: string;
    type: InstrumentType;
    status: InstrumentStatus;
    baseAsset?: string;
    quoteAsset?: string;
}

export type Side = 'buy' | 'sell';
