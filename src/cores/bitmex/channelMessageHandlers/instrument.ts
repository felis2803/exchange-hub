import type { BitMex } from '..';
import type { BitMexInstrument } from '../types';

export const instrument = {
    partial(core: BitMex, data: BitMexInstrument[]) {
        data.forEach(item => core.instruments.set(item.symbol, item));
    },

    insert(core: BitMex, data: BitMexInstrument[]) {
        data.forEach(item => core.instruments.set(item.symbol, item));
    },

    update(core: BitMex, data: BitMexInstrument[]) {
        data.forEach(item => {
            const prev = core.instruments.get(item.symbol) || {};
            core.instruments.set(item.symbol, { ...prev, ...item });
        });
    },

    delete(core: BitMex, data: BitMexInstrument[]) {
        data.forEach(item => core.instruments.delete(item.symbol));
    },
};
