import type { BitMex } from '..';
import type { BitMexMargin } from '../types';

export const margin = {
    partial(core: BitMex, data: BitMexMargin[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexMargin[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexMargin[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexMargin[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
