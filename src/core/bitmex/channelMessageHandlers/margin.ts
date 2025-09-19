import type { BitMex } from '../index.js';
import type { BitMexMargin } from '../types.js';

export const margin = {
  partial(_core: BitMex, _data: BitMexMargin[]) {
    throw 'not implemented';
  },

  insert(_core: BitMex, _data: BitMexMargin[]) {
    throw 'not implemented';
  },

  update(_core: BitMex, _data: BitMexMargin[]) {
    throw 'not implemented';
  },

  delete(_core: BitMex, _data: BitMexMargin[]) {
    throw 'not implemented';
  },
};
