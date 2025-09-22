import type { Side } from '../types.js';

export type BitmexTradeRaw = {
    symbol: string;
    side: 'Buy' | 'Sell';
    size?: number;
    price?: number;
    foreignNotional?: number;
    timestamp: string;
    trdMatchID?: string;
};

export type Trade = {
    ts: number;
    side: Side;
    price: number;
    size?: number;
    id?: string;
    foreignNotional?: number;
};

export type BitmexTrade = Trade;

export type BitmexOrderBookL2Raw = {
    symbol: string;
    id: number;
    side: 'Buy' | 'Sell';
    size?: number;
    price?: number;
    timestamp?: string;
    transactTime?: string;
};
