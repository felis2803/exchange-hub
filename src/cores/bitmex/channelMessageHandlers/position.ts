import type { BitMex } from '../index.js';
import type { BitMexPosition } from '../types.js';

export const position = {
    partial(core: BitMex, data: BitMexPosition[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexPosition[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexPosition[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexPosition[]) {
        throw 'not implemented';
    },
};
