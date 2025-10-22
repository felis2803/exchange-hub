import { createEntity } from './createEntity';
import { createAssets } from './createAssets';
import { createInstrument } from './createInstruments';
import { createOrder } from './createOrders';
import { createTrade } from './createTrade';
import { createWallet } from './createWallet';
import { createPosition } from './createPosition';

import type { ExchangeHub } from '../ExchangeHub';
import type { ExchangeName } from '../types';

export function createEntities<ExName extends ExchangeName>(eh: ExchangeHub<ExName>) {
    const Entity = createEntity(eh);
    const Asset = createAssets(Entity);
    const Instrument = createInstrument(Entity);
    const Order = createOrder(Entity);
    const Trade = createTrade(Entity);
    const Wallet = createWallet(Entity);
    const Position = createPosition(Entity);

    return { Entity, Asset, Instrument, Order, Trade, Wallet, Position };
}
