import {
  handlePositionDelete,
  handlePositionInsert,
  handlePositionPartial,
  handlePositionUpdate,
} from '../channels/position.js';

import type { BitMex } from '../index.js';
import type { BitMexPosition } from '../types.js';

export const position = {
  partial(core: BitMex, data: BitMexPosition[]) {
    handlePositionPartial(core, data);
  },

  insert(core: BitMex, data: BitMexPosition[]) {
    handlePositionInsert(core, data);
  },

  update(core: BitMex, data: BitMexPosition[]) {
    handlePositionUpdate(core, data);
  },

  delete(core: BitMex, data: BitMexPosition[]) {
    handlePositionDelete(core, data);
  },
};
