import type { BitMex } from '..';
import type { BitMexPosition } from '../types';

export const position = {
    partial(core: BitMex, data: BitMexPosition[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexPosition[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexPosition[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexPosition[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
