import type { BitMex } from '../index';
import type { BitMexExecution } from '../types';

export const execution = {
    partial(core: BitMex, data: BitMexExecution[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexExecution[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexExecution[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexExecution[]) {
        throw 'not implemented';
    },
};
