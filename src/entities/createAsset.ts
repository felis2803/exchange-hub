import type { ExchangeHub } from '../ExchangeHub';
import type { EntityClass } from './createEntity';

export const createAsset = (hub: ExchangeHub<any>, Entity: EntityClass) => {
    class Asset extends Entity {
        static hub = hub;
        symbol: string;
        instruments: any[] = [];
        baseFor: any[] = [];
        quoteFor: any[] = [];

        constructor(symbol: string) {
            super();
            this.symbol = symbol;
        }
    }

    return Asset;
};

export type AssetClass = ReturnType<typeof createAsset>;
export type Asset = InstanceType<AssetClass>;
