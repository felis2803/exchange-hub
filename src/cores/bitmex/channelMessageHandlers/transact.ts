import type { BitMex } from '..';
import type { BitMexTransact } from '../types';

export const transact = {
    partial(core: BitMex, data: BitMexTransact[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexTransact[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexTransact[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexTransact[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
