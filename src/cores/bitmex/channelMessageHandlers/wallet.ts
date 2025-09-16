import type { BitMex } from '../index.js';
import type { BitMexWallet } from '../types.js';

export const wallet = {
    partial(core: BitMex, data: BitMexWallet[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexWallet[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexWallet[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexWallet[]) {
        throw 'not implemented';
    },
};
