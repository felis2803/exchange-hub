import { EventEmitter } from 'events';
import { EntityMap } from './entities/EntityMap';
import { Asset } from './entities/Asset';
import { Wallet } from './entities/Wallet';
import { Instrument } from './entities/Instrument';
import { Order } from './entities/Order';
import { Position } from './entities/Position';

export class ExchangeHub extends EventEmitter {
    assets: EntityMap<Asset>;
    wallets: EntityMap<Wallet>;
    instruments: EntityMap<Instrument>;
    orders: EntityMap<Order>;
    positions: EntityMap<Position>;
    marginFunds: number;

    constructor(
        private exchange: string,
        private credentials?: { apiKey: string; apiSecret: string },
    ) {
        super();
        this.assets = new EntityMap<Asset>();
        this.wallets = new EntityMap<Wallet>();
        this.instruments = new EntityMap<Instrument>();
        this.orders = new EntityMap<Order>();
        this.positions = new EntityMap<Position>();
        this.marginFunds = 0;
    }
}
