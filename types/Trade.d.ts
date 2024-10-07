// Trade.d.ts
export type TradeTimestamp = Date;
export type TradeVolume = number;
export type TradePrice = number;

export interface ITrade {
    timestamp: TradeTimestamp;
    volume: TradeVolume;
    price: TradePrice;
}
