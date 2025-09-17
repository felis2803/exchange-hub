import type { BitMex } from '../index.js';
import type { BitMexOrderBookL2 } from '../types.js';

export const orderBookL2 = {
  partial(_core: BitMex, _data: BitMexOrderBookL2[]) {
    throw 'not implemented';
  },

  insert(_core: BitMex, _data: BitMexOrderBookL2[]) {
    throw 'not implemented';
  },

  update(_core: BitMex, _data: BitMexOrderBookL2[]) {
    throw 'not implemented';
  },

  delete(_core: BitMex, _data: BitMexOrderBookL2[]) {
    throw 'not implemented';
  },
};
