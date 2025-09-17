import type { BitMex } from '../index.js';
import type { BitMexTrade } from '../types.js';

export const trade = {
  partial(core: BitMex, data: BitMexTrade[]) {
    throw 'not implemented';
  },

  insert(core: BitMex, data: BitMexTrade[]) {
    throw 'not implemented';
  },

  update(core: BitMex, data: BitMexTrade[]) {
    throw 'not implemented';
  },

  delete(core: BitMex, data: BitMexTrade[]) {
    throw 'not implemented';
  },
};
