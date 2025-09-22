import type { BitMex } from '../index';
import type { BitMexOrderBookL2 } from '../types';

export const orderBookL2 = {
    partial(core: BitMex, data: BitMexOrderBookL2[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexOrderBookL2[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexOrderBookL2[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexOrderBookL2[]) {
        throw 'not implemented';
    },
};
