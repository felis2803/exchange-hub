import type { ExchangeHub } from '../ExchangeHub';
import type { EntityClass } from './createEntity';
import type { InstrumentClass } from './createInstrument';

export const createOrder = (hub: ExchangeHub<any>, Entity: EntityClass) => {
    class Order extends Entity {
        static hub = hub;
        id: string;
        instrument: InstanceType<InstrumentClass>;
        price: number;
        size: number;

        constructor(
            id: string,
            { instrument, price, size }: { instrument: InstanceType<InstrumentClass>; price: number; size: number },
        ) {
            super();
            this.id = id;
            this.instrument = instrument;
            this.price = price;
            this.size = size;
        }
    }

    return Order;
};

export type OrderClass = ReturnType<typeof createOrder>;
export type Order = InstanceType<OrderClass>;
