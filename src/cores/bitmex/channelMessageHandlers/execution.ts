import type { BitMex } from '../index.js';
import type { BitMexExecution } from '../types.js';

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
