import { createEntity } from './createEntity.js';
import { createAsset } from './createAsset.js';
import { createInstrument } from './createInstrument.js';
import { createOrder } from './createOrder.js';
import { createTrade } from './createTrade.js';
import { createWallet } from './createWallet.js';
import { createPosition } from './createPosition.js';

import type { ExchangeHub } from '../ExchangeHub.js';
import type { ExchangeName } from '../types.js';

export function createEntities<ExName extends ExchangeName>(eh: ExchangeHub<ExName>) {
  const Entity = createEntity(eh);
  const Asset = createAsset(eh, Entity);
  const Instrument = createInstrument(eh, Entity);
  const Order = createOrder(eh, Entity);
  const Trade = createTrade(eh, Entity);
  const Wallet = createWallet(eh, Entity);
  const Position = createPosition(eh, Entity);

  return { Entity, Asset, Instrument, Order, Trade, Wallet, Position };
}
