import type { BitMex } from '../index.js';
import type { BitMexOrder } from '../types.js';

export const order = {
  partial(core: BitMex, data: BitMexOrder[]) {
    throw 'not implemented';
  },

  insert(core: BitMex, data: BitMexOrder[]) {
    throw 'not implemented';
  },

  update(core: BitMex, data: BitMexOrder[]) {
    throw 'not implemented';
  },

  delete(core: BitMex, data: BitMexOrder[]) {
    throw 'not implemented';
  },
};
