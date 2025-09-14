import type { BitMex } from '..';
import type { BitMexWallet } from '../types';

export const wallet = {
    partial(_core: BitMex, _data: BitMexWallet[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexWallet[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexWallet[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexWallet[]) {
        throw 'not implemented';
    },
};
