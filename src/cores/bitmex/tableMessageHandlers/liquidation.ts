import type { BitMex } from '..';
import type { BitMexLiquidation } from '../types';

export const liquidation = {
    partial(_core: BitMex, _data: BitMexLiquidation[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexLiquidation[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexLiquidation[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexLiquidation[]) {
        throw 'not implemented';
    },
};
