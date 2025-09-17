import type { ExchangeHub } from '../ExchangeHub';
import type { ExchangeName } from '../types';
import type { EntityClass } from './createEntity';

type OrderBookLevel = {
  price: number;
  size: number;
};

export function createOrderBook<ExName extends ExchangeName>(
  eh: ExchangeHub<ExName>,
  Entity: EntityClass<ExName>,
) {
  class OrderBook extends Entity {
    static eh = eh;

    instrument: any;
    bids: OrderBookLevel[] = [];
    asks: OrderBookLevel[] = [];

    constructor(instrument: any) {
      super();

      this.instrument = instrument;
    }
  }

  return OrderBook;
}

export type OrderBookClass<ExName extends ExchangeName> = ReturnType<
  typeof createOrderBook<ExName>
>;
export type OrderBook<ExName extends ExchangeName> = InstanceType<OrderBookClass<ExName>>;
