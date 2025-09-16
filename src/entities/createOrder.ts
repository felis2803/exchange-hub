import type { ExchangeHub } from '../ExchangeHub';
import type { ExchangeName } from '../types';
import type { EntityClass } from './createEntity';
import type { Instrument } from './createInstrument';

export function createOrder<ExName extends ExchangeName>(eh: ExchangeHub<ExName>, Entity: EntityClass<ExName>) {
    class Order extends Entity {
        static eh = eh;

        id: string;
        instrument: Instrument<ExName>;
        price: number;
        size: number;

        constructor(id: string, { instrument, price, size }: Omit<Order, 'id'>) {
            super();

            this.id = id;
            this.instrument = instrument;
            this.price = price;
            this.size = size;
        }
    }

    return Order;
}

export type OrderClass<ExName extends ExchangeName> = ReturnType<typeof createOrder<ExName>>;
export type Order<ExName extends ExchangeName> = InstanceType<OrderClass<ExName>>;
