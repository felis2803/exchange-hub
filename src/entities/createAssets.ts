import { createContainer } from './createContainer';

import type { Instrument } from './createInstruments';
import type { ExchangeName } from '../types';
import type { EntityClass } from './createEntity';
import { ASSET_TYPES } from '../constants';

const ASSET_PROTO = {
    type: ASSET_TYPES,
} as const;

const META_FIELDS = Reflect.ownKeys(ASSET_PROTO) as (keyof typeof ASSET_PROTO)[];

export function createAssets<ExName extends ExchangeName>(Entity: EntityClass<ExName>) {
    class Asset extends Entity {
        symbol: string;
        instruments: Instrument[] = [];
        baseFor: Instrument[] = [];
        quoteFor: Instrument[] = [];

        constructor(symbol: string) {
            super();

            this.symbol = symbol;
        }
    }

    const Assets = createContainer(Asset, ASSET_PROTO);

    return new Assets(META_FIELDS);
}

export type AssetClass = ReturnType<typeof createAssets>['Entity'];
export type Asset = InstanceType<AssetClass>;
