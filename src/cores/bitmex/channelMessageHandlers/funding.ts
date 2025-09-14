import type { BitMex } from '..';
import type { BitMexFunding } from '../types';

export const funding = {
    partial(core: BitMex, data: BitMexFunding[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexFunding[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexFunding[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexFunding[]) {
        throw 'not implemented';
    },
};
