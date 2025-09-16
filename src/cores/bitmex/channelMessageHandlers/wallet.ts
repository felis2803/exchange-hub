import type { BitMex } from '..';
import type { BitMexWallet } from '../types';

export const wallet = {
    partial(core: BitMex, data: BitMexWallet[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexWallet[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexWallet[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexWallet[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
