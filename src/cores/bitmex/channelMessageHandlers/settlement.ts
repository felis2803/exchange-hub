import type { BitMex } from '../index.js';
import type { BitMexSettlement } from '../types.js';

export const settlement = {
  partial(core: BitMex, data: BitMexSettlement[]) {
    throw 'not implemented';
  },

  insert(core: BitMex, data: BitMexSettlement[]) {
    throw 'not implemented';
  },

  update(core: BitMex, data: BitMexSettlement[]) {
    throw 'not implemented';
  },

  delete(core: BitMex, data: BitMexSettlement[]) {
    throw 'not implemented';
  },
};
