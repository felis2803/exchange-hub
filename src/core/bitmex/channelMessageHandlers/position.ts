import {
    handlePositionDelete,
    handlePositionInsert,
    handlePositionPartial,
    handlePositionUpdate,
} from '../channels/position';
import type { BitMex } from '../index';
import type { BitMexPosition } from '../types';

export const position = {
    partial(core: BitMex, data: BitMexPosition[]) {
        handlePositionPartial(core, data);
    },

    insert(core: BitMex, data: BitMexPosition[]) {
        handlePositionInsert(core, data);
    },

    update(core: BitMex, data: BitMexPosition[]) {
        handlePositionUpdate(core, data);
    },

    delete(core: BitMex, data: BitMexPosition[]) {
        handlePositionDelete(core, data);
    },
};
