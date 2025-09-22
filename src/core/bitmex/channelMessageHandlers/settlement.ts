import type { BitMex } from '../index.js';
import type { BitMexSettlement } from '../types.js';

export const settlement = {
    partial(_core: BitMex, _data: BitMexSettlement[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexSettlement[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexSettlement[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexSettlement[]) {
        throw 'not implemented';
    },
};
