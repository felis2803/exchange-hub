import type { BitMex } from '../index.js';
import type { BitMexPosition } from '../types.js';

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
