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

export type Side = 'buy' | 'sell';
