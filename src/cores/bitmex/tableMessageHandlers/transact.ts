import type { BitMex } from '..';
import type { BitMexTransact } from '../types';

export const transact = {
    partial(_core: BitMex, _data: BitMexTransact[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexTransact[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexTransact[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexTransact[]) {
        throw 'not implemented';
    },
};
