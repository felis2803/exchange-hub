import type { BitMex } from '..';
import type { BitMexPosition } from '../types';

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
