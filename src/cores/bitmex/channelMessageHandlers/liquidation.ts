import type { BitMex } from '../index.js';
import type { BitMexLiquidation } from '../types.js';

export const liquidation = {
    partial(core: BitMex, data: BitMexLiquidation[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexLiquidation[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexLiquidation[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexLiquidation[]) {
        throw 'not implemented';
    },
};
