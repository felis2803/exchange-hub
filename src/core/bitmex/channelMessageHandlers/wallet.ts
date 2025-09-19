import type { BitMex } from '../index.js';
import type { BitMexWallet } from '../types.js';

export const wallet = {
  partial(_core: BitMex, _data: BitMexWallet[]) {
    throw 'not implemented';
  },

  insert(_core: BitMex, _data: BitMexWallet[]) {
    throw 'not implemented';
  },

  update(_core: BitMex, _data: BitMexWallet[]) {
    throw 'not implemented';
  },

  delete(_core: BitMex, _data: BitMexWallet[]) {
    throw 'not implemented';
  },
};
