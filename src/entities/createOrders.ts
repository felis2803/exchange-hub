import { createContainer } from './createContainer';

import type { ExchangeName } from '../types';
import type { EntityClass } from './createEntity';
import type { Instrument } from './createInstruments';
import { ORDER_STATUSES, ORDER_TYPES } from '../constants';

const ORDER_PROTO = {
    type: ORDER_TYPES,
    status: ORDER_STATUSES,
} as const;

const META_FIELDS = Reflect.ownKeys(ORDER_PROTO) as (keyof typeof ORDER_PROTO)[];

export function createOrders<ExName extends ExchangeName>(Entity: EntityClass<ExName>) {
    class Order extends Entity {
        id: string;
        instrument?: Instrument;
        size?: number;
        price?: number;

        constructor(id: string) {
            super();

            this.id = id;
        }
    }

    const Orders = createContainer(Order, ORDER_PROTO);

    return new Orders(META_FIELDS);
}

export type OrderClass = ReturnType<typeof createOrders>;
export type Order = InstanceType<OrderClass>;
