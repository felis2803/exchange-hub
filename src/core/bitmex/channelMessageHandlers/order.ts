import type { BitMex } from '../index.js';
import type { BitMexOrder } from '../types.js';

export const order = {
  partial(_core: BitMex, _data: BitMexOrder[]) {
    throw 'not implemented';
  },

  insert(_core: BitMex, _data: BitMexOrder[]) {
    throw 'not implemented';
  },

  update(_core: BitMex, _data: BitMexOrder[]) {
    throw 'not implemented';
  },

  delete(_core: BitMex, _data: BitMexOrder[]) {
    throw 'not implemented';
  },
};
