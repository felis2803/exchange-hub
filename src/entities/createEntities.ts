import { createEntity } from './createEntity';
import { createAsset } from './createAsset';
import { createOrderBook } from './createOrderBook';
import { createInstrument } from './createInstrument';
import { createOrder } from './createOrder';
import { createTrade } from './createTrade';
import { createWallet } from './createWallet';
import { createPosition } from './createPosition';

import type { ExchangeHub } from '../ExchangeHub';

export const createEntities = (hub: ExchangeHub<any>) => {
    const Entity = createEntity(hub);
    const Asset = createAsset(hub, Entity);
    const OrderBook = createOrderBook(hub, Entity);
    const Instrument = createInstrument(hub, Entity, OrderBook);
    const Order = createOrder(hub, Entity);
    const Trade = createTrade(hub, Entity);
    const Wallet = createWallet(hub, Entity);
    const Position = createPosition(hub, Entity);

    return { Entity, Asset, OrderBook, Instrument, Order, Trade, Wallet, Position };
};

export type Entities = ReturnType<typeof createEntities>;
export type EntityClass = Entities['Entity'];
export type Asset = InstanceType<Entities['Asset']>;
export type Instrument = InstanceType<Entities['Instrument']>;
export type OrderBook = InstanceType<Entities['OrderBook']>;
export type Order = InstanceType<Entities['Order']>;
export type Trade = InstanceType<Entities['Trade']>;
export type Wallet = InstanceType<Entities['Wallet']>;
export type Position = InstanceType<Entities['Position']>;
