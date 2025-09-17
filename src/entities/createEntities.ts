import { createEntity } from './createEntity';
import { createAsset } from './createAsset';
import { createInstrument } from './createInstrument';
import { createOrder } from './createOrder';
import { createTrade } from './createTrade';
import { createWallet } from './createWallet';
import { createPosition } from './createPosition';

import type { ExchangeHub } from '../ExchangeHub';
import type { ExchangeName } from '../types';

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
