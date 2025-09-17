import type { BitMex } from '../index.js';
import type { BitMexMargin } from '../types.js';

export const margin = {
  partial(core: BitMex, data: BitMexMargin[]) {
    throw 'not implemented';
  },

  insert(core: BitMex, data: BitMexMargin[]) {
    throw 'not implemented';
  },

  update(core: BitMex, data: BitMexMargin[]) {
    throw 'not implemented';
  },

  delete(core: BitMex, data: BitMexMargin[]) {
    throw 'not implemented';
  },
};
