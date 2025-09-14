import type { BitMex } from '..';
import type { BitMexPosition } from '../types';

export const position = {
    partial(_core: BitMex, _data: BitMexPosition[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexPosition[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexPosition[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexPosition[]) {
        throw 'not implemented';
    },
};
