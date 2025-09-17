import type { BitMex } from '../index.js';
import type { BitMexTrade } from '../types.js';

export const trade = {
  partial(_core: BitMex, _data: BitMexTrade[]) {
    throw 'not implemented';
  },

  insert(_core: BitMex, _data: BitMexTrade[]) {
    throw 'not implemented';
  },

  update(_core: BitMex, _data: BitMexTrade[]) {
    throw 'not implemented';
  },

  delete(_core: BitMex, _data: BitMexTrade[]) {
    throw 'not implemented';
  },
};
