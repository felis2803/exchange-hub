// Order.d.ts
import { IEntity } from './Entity';

export type OrderVolume = number;
export type OrderPrice = number;
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'placed' | 'filled' | 'rejected' | 'canceled';
export type OrderId = string;
export type OrderTimestamp = Date;

export interface IOrderOptions {
    placeOnly?: boolean;
}

export type RejectReasonDescription = string;
export type RejectReasonCode = number;

export interface IRejectOrderReason {
    description: RejectReasonDescription;
    code?: RejectReasonCode;
}

export type OrderEvent = 'place' | 'reject' | 'filled' | 'cancel';

export type OrderPlaceListener = (order: IOrder) => void | false;
export type OrderRejectListener = (
    order: IOrder,
    reason: IRejectOrderReason,
) => void | false;
export type OrderFilledListener = (order: IOrder) => void | false;
export type OrderCancelListener = (order: IOrder) => void | false;

export interface IOrder extends IEntity {
    volume: OrderVolume;
    price: OrderPrice;
    side: OrderSide;
    status: OrderStatus;
    id: OrderId;
    timestamp: OrderTimestamp;

    // Методы событий
    on(event: 'place', listener: OrderPlaceListener): this;
    on(event: 'reject', listener: OrderRejectListener): this;
    on(event: 'filled', listener: OrderFilledListener): this;
    on(event: 'cancel', listener: OrderCancelListener): this;
}

export interface IOrdersArray extends Array<IOrder>, IEntity {
    number: number;

    closeAll(): Promise<void>;
}
