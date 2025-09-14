import type { BitMex } from '..';
import type { BitMexInstrument } from '../types';

export const instrument = {
    partial(_core: BitMex, _data: BitMexInstrument[]) {
        throw 'not implemented';
    },

    insert(_core: BitMex, _data: BitMexInstrument[]) {
        throw 'not implemented';
    },

    update(_core: BitMex, _data: BitMexInstrument[]) {
        throw 'not implemented';
    },

    delete(_core: BitMex, _data: BitMexInstrument[]) {
        throw 'not implemented';
    },
};
