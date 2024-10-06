import { EventEmitter } from 'events';
import { EntityMap } from './entities/EntityMap';
import { Asset } from './entities/Asset';
import { Wallet } from './entities/Wallet';
import { Instrument } from './entities/Instrument';
import { Order } from './entities/Order';
import { Position } from './entities/Position';
import { Core, ExchangeNames, initCore } from 'cores';
import { Settings } from 'cores/Settings';

export class ExchangeHub extends EventEmitter {
    assets: EntityMap<Asset>;
    wallets: EntityMap<Wallet>;
    instruments: EntityMap<Instrument>;
    orders: EntityMap<Order>;
    positions: EntityMap<Position>;
    marginFunds: number;
    core: Core | null;

    constructor(
        private exchange: ExchangeNames,
        private credentials?: Settings,
    ) {
        super();
        this.assets = new EntityMap<Asset>();
        this.wallets = new EntityMap<Wallet>();
        this.instruments = new EntityMap<Instrument>();
        this.orders = new EntityMap<Order>();
        this.positions = new EntityMap<Position>();
        this.marginFunds = 0;

        this.core = null;

        initCore(exchange, credentials).then((core) => {
            this.core = core;
        });
    }

    async connect() {
        await this.core?.connect();

        this.emit('connect');
    }

    async disconnect() {
        await this.core?.disconnect();

        this.emit('disconnect');
    }
}
