import type { BitMex } from '..';
import type { BitMexFunding } from '../types';

export const funding = {
    partial(_core: BitMex, _data: BitMexFunding[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexFunding[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexFunding[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexFunding[]) {
        throw 'not implemented';
    },
};
