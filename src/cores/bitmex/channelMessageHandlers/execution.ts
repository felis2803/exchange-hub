import type { BitMex } from '..';
import type { BitMexExecution } from '../types';

export const execution = {
    partial(core: BitMex, data: BitMexExecution[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexExecution[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexExecution[]) {
        void core;
        void data;
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexExecution[]) {
        void core;
        void data;
        throw 'not implemented';
    },
};
