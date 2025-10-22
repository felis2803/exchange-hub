import { createOrderBook } from './createOrderBook';
import { createContainer } from './createContainer';

import type { Order } from './createOrders';
import type { Trade } from './createTrade';
import type { EntityClass } from './createEntity';
import type { Asset } from './createAssets';
import type { ExchangeName, InstrumentStatus, InstrumentType } from '../types';
import { INSTRUMENT_STATUSES, INSTRUMENT_TYPES } from '../constants';

const INSTRUMENT_PROTO = {
    type: INSTRUMENT_TYPES,
    status: INSTRUMENT_STATUSES,
} as const;

const META_FIELDS = Reflect.ownKeys(INSTRUMENT_PROTO) as (keyof typeof INSTRUMENT_PROTO)[];

export function createInstrument<ExName extends ExchangeName>(Entity: EntityClass<ExName>) {
    class Instrument extends Entity {
        symbol: string;
        type?: InstrumentType;
        status?: InstrumentStatus;
        baseAsset?: Asset;
        quoteAsset?: Asset;
        trades: Trade<ExName>[] = [];
        bid = NaN;
        ask = NaN;
        orderBook = new (createOrderBook<ExName>(Entity))(this);
        orders: Order[] = [];

        constructor(symbol: string) {
            super();

            this.symbol = symbol;
        }

        async buy(_size: number, _price?: number): Promise<Order> {
            throw 'not implemented';
        }

        async sell(_size: number, _price?: number): Promise<Order> {
            throw 'not implemented';
        }
    }

    const Instruments = createContainer(Instrument, INSTRUMENT_PROTO);

    return new Instruments(META_FIELDS);
}

export type InstrumentClass = ReturnType<typeof createInstrument>['Entity'];
export type Instrument = InstanceType<InstrumentClass>;
