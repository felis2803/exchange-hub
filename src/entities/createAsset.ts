import type { Instrument } from './createInstrument';
import type { ExchangeHub } from '../ExchangeHub';
import type { ExchangeName } from '../types';
import type { EntityClass } from './createEntity';

export function createAsset<ExName extends ExchangeName>(
  eh: ExchangeHub<ExName>,
  Entity: EntityClass<ExName>,
) {
  class Asset extends Entity {
    static eh = eh;

    symbol: string;
    instruments: Instrument<ExName>[] = [];
    baseFor: Instrument<ExName>[] = [];
    quoteFor: Instrument<ExName>[] = [];

    constructor(symbol: string) {
      super();

      this.symbol = symbol;
    }
  }

  return Asset;
}

export type AssetClass<ExName extends ExchangeName> = ReturnType<typeof createAsset<ExName>>;

export type Asset<ExName extends ExchangeName> = InstanceType<AssetClass<ExName>>;
