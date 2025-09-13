import type { BitMex } from '..';
import type { BitMexInstrument } from '../types';

export const instrument = {
    partial(core: BitMex, data: BitMexInstrument[]) {
        throw 'not implemented';
    },

    insert(core: BitMex, data: BitMexInstrument[]) {
        throw 'not implemented';
    },

    update(core: BitMex, data: BitMexInstrument[]) {
        throw 'not implemented';
    },

    delete(core: BitMex, data: BitMexInstrument[]) {
        throw 'not implemented';
    },
};
