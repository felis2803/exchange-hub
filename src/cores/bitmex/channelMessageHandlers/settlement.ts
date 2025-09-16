import type { BitMex } from '..';
import type { BitMexSettlement } from '../types';

export const settlement = {
    partial(core: BitMex, data: BitMexSettlement[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexSettlement[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexSettlement[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexSettlement[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
