import type { BitMex } from '../index';
import type { BitMexTransact } from '../types';

export const transact = {
    partial(core: BitMex, data: BitMexTransact[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexTransact[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexTransact[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexTransact[]) {
        throw 'not implemented';
    },
};
