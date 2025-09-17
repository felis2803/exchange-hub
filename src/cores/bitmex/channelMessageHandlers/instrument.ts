import {
  handleInstrumentDelete,
  handleInstrumentInsert,
  handleInstrumentPartial,
  handleInstrumentUpdate,
} from '../channels/instrument.js';

import type { BitMex } from '../index.js';
import type { BitMexInstrument } from '../types.js';

export const instrument = {
  partial(core: BitMex, data: BitMexInstrument[]) {
    handleInstrumentPartial(core, data);
  },

  insert(core: BitMex, data: BitMexInstrument[]) {
    handleInstrumentInsert(core, data);
  },

  update(core: BitMex, data: BitMexInstrument[]) {
    handleInstrumentUpdate(core, data);
  },

  delete(core: BitMex, data: BitMexInstrument[]) {
    handleInstrumentDelete(core, data);
  },
};
