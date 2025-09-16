import type { Cores } from './cores/index.js';

export type ExchangeName = keyof typeof Cores;

export type ApiKey = string;

export type ApiSec = string;

export type Settings = {
    apiKey?: ApiKey;
    apiSec?: ApiSec;
    isTest?: boolean;
};

export type Side = 'buy' | 'sell';
