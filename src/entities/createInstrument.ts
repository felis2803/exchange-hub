import { createOrderBook } from './createOrderBook';

import type { Order } from './createOrder';
import type { Trade } from './createTrade';
import type { ExchangeHub } from '../ExchangeHub';
import type { EntityClass } from './createEntity';
import type { Asset } from './createAsset';
import type { ExchangeName } from '../types';

export function createInstrument<ExName extends ExchangeName>(eh: ExchangeHub<ExName>, Entity: EntityClass<ExName>) {
    class Instrument extends Entity {
        static eh = eh;

        symbol: string;
        baseAsset: Asset<ExName>;
        quoteAsset: Asset<ExName>;
        trades: Trade<ExName>[] = [];
        bid = NaN;
        ask = NaN;
        orderBook: InstanceType<ReturnType<typeof createOrderBook<ExName>>> = new (createOrderBook(eh, Entity))(this);
        orders: Order<ExName>[] = [];

        constructor(symbol: string, { baseAsset, quoteAsset }: Omit<Instrument, 'symbol'>) {
            super();

            this.symbol = symbol;
            this.baseAsset = baseAsset;
            this.quoteAsset = quoteAsset;
        }
    }

    return Instrument;
}

export type InstrumentClass<ExName extends ExchangeName> = ReturnType<typeof createInstrument<ExName>>;
export type Instrument<ExName extends ExchangeName> = InstanceType<InstrumentClass<ExName>>;
