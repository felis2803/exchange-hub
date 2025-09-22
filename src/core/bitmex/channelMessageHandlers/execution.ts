import type { BitMex } from '../index';
import type { BitMexExecution } from '../types';

export const execution = {
    partial(_core: BitMex, _data: BitMexExecution[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexExecution[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexExecution[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexExecution[]) {
        throw 'not implemented';
    },
};
