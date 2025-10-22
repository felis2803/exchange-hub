import type { ExchangeName, Side } from '../types';
import type { EntityClass } from './createEntity';
import type { Instrument } from './createInstruments';

export function createTrade<ExName extends ExchangeName>(Entity: EntityClass<ExName>) {
    class Trade extends Entity {
        id: string;
        instrument: Instrument<ExName>;
        price: number;
        size: number;
        timestamp: Date;

        constructor(
            id: string,
            {
                instrument,
                price,
                size,
                timestamp,
            }: {
                instrument: Instrument<ExName>;
                price: number;
                size: number;
                timestamp: Date;
            },
        ) {
            super();

            this.id = id;
            this.instrument = instrument;
            this.price = price;
            this.size = size;
            this.timestamp = timestamp;
        }

        get side(): Side {
            return this.size > 0 ? 'buy' : 'sell';
        }
    }

    return Trade;
}

export type TradeClass<ExName extends ExchangeName> = ReturnType<typeof createTrade<ExName>>;
export type Trade<ExName extends ExchangeName> = InstanceType<TradeClass<ExName>>;
