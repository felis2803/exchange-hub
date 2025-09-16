import type { BitMex } from '..';
import type { BitMexOrder } from '../types';

export const order = {
    partial(core: BitMex, data: BitMexOrder[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexOrder[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexOrder[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexOrder[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
