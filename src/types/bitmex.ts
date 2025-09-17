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

export type BitmexTrade = {
  ts: number;
  side: Side;
  price: number;
  size?: number;
  id?: string;
  foreignNotional?: number;
};
