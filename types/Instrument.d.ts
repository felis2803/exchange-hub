// Instrument.d.ts
import { IEntity } from './Entity';
import { ITrade } from './Trade';
import {
    IOrdersArray,
    IOrderOptions,
    IOrder,
    OrderVolume,
    OrderPrice,
} from './Order';
import { IPosition } from './Position';

export type InstrumentSymbol = string;
export type InstrumentMinVolume = number;
export type InstrumentEvent = 'trade';
export type InstrumentTradeListener = (trade: ITrade) => void | false;

export interface IInstrument extends IEntity {
    orders: IOrdersArray;
    position: IPosition;
    trades: ITrade[];
    minVolume: InstrumentMinVolume;

    buy(
        volume: OrderVolume,
        price: OrderPrice,
        options?: IOrderOptions,
    ): IOrder;

    sell(
        volume: OrderVolume,
        price: OrderPrice,
        options?: IOrderOptions,
    ): IOrder;

    on(event: InstrumentEvent, listener: InstrumentTradeListener): this;
}
