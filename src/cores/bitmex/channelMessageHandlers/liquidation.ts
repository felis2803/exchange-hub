import type { BitMex } from '..';
import type { BitMexLiquidation } from '../types';

export const liquidation = {
    partial(core: BitMex, data: BitMexLiquidation[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexLiquidation[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexLiquidation[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexLiquidation[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
