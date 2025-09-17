import type { BitMex } from '../index.js';
import type { BitMexTransact } from '../types.js';

export const transact = {
  partial(core: BitMex, data: BitMexTransact[]) {
    throw 'not implemented';
  },

  insert(core: BitMex, data: BitMexTransact[]) {
    throw 'not implemented';
  },

  update(core: BitMex, data: BitMexTransact[]) {
    throw 'not implemented';
  },

  delete(core: BitMex, data: BitMexTransact[]) {
    throw 'not implemented';
  },
};
