import type { BitMex } from '../index';
import type { BitMexMargin } from '../types';

export const margin = {
    partial(_core: BitMex, _data: BitMexMargin[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexMargin[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexMargin[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexMargin[]) {
        throw 'not implemented';
    },
};
