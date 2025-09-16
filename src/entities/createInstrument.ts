import { createOrderBook } from './createOrderBook.js';

import type { Order } from './createOrder.js';
import type { Trade } from './createTrade.js';
import type { ExchangeHub } from '../ExchangeHub.js';
import type { EntityClass } from './createEntity.js';
import type { Asset } from './createAsset.js';
import type { ExchangeName } from '../types.js';

export function createInstrument<ExName extends ExchangeName>(eh: ExchangeHub<ExName>, Entity: EntityClass<ExName>) {
    class Instrument extends Entity {
        static override eh = eh;

        symbol: string;
        baseAsset: Asset<ExName>;
        quoteAsset: Asset<ExName>;
        trades: Trade<ExName>[] = [];
        bid = NaN;
        ask = NaN;
        orderBook = new (createOrderBook<ExName>(eh, Entity))(this);
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
