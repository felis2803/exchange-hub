import type { BitMex } from '../index.js';
import type { BitMexTransact } from '../types.js';

export const transact = {
  partial(_core: BitMex, _data: BitMexTransact[]) {
    throw 'not implemented';
  },

  insert(_core: BitMex, _data: BitMexTransact[]) {
    throw 'not implemented';
  },

  update(_core: BitMex, _data: BitMexTransact[]) {
    throw 'not implemented';
  },

  delete(_core: BitMex, _data: BitMexTransact[]) {
    throw 'not implemented';
  },
};
