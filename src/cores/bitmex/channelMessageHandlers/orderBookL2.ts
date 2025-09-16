import type { BitMex } from '..';
import type { BitMexOrderBookL2 } from '../types';

export const orderBookL2 = {
    partial(core: BitMex, data: BitMexOrderBookL2[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexOrderBookL2[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexOrderBookL2[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexOrderBookL2[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
