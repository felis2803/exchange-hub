import { Cores } from './core/index';
import { createEntities } from './entities/index';
import { OrdersRegistry } from './core/exchange-hub';
import { PositionsRegistry, type PositionsView } from './domain/position';
import { incrementCounter } from './infra/metrics';
import { METRICS as PRIVATE_METRICS } from './infra/metrics-private';
import { Wallet } from './domain/wallet';

import type { BaseCore } from './core/BaseCore';
import type { AccountId } from './core/types';
import type { ExchangeName, Settings } from './types';

export class ExchangeHub<ExName extends ExchangeName> {
    #entities = createEntities(this);
    #core: BaseCore<ExName>;
    #isTest: boolean;
    #orders = new OrdersRegistry();
    #positions: PositionsRegistry;
    #positionsView: PositionsView;
    #wallets: Map<AccountId, Wallet> = new Map();

    constructor(exchangeName: ExName, settings: Settings = {}) {
        const { isTest } = settings;
        const env: 'testnet' | 'mainnet' = isTest ? 'testnet' : 'mainnet';

        this.#positions = new PositionsRegistry({
            onUpdate: (_position, snapshot) => {
                incrementCounter(PRIVATE_METRICS.positionUpdateCount, 1, {
                    env,
                    table: 'position',
                    symbol: snapshot.symbol,
                });
            },
        });
        this.#positionsView = this.#positions.asReadonly();
        this.#core = new Cores[exchangeName](this, settings);
        this.#isTest = isTest || false;
    }

    get Core() {
        return this.#core;
    }

    get entities() {
        return this.#entities;
    }

    get orders(): OrdersRegistry {
        return this.#orders;
    }

    get positions(): PositionsView {
        return this.#positionsView;
    }

    /**
     * Internal mutable registry for core handlers. External consumers should use {@link positions}.
     */
    get positionsRegistry(): PositionsRegistry {
        return this.#positions;
    }

    /**
     * Read-only collection of wallets keyed by account id.
     *
     * The underlying map is owned by the hub and should only be mutated
     * internally via `ensureWallet` or wallet stream updates to keep the cache
     * consistent.
     */
    get wallets(): ReadonlyMap<AccountId, Wallet> {
        return this.#wallets;
    }

    get isTest(): boolean {
        return this.#isTest;
    }

    get instruments() {
        return this.#core.instruments;
    }

    getWallet(accountId: AccountId): Wallet | undefined {
        const normalized = ExchangeHub.#normalizeAccountId(accountId);

        return normalized ? this.#wallets.get(normalized) : undefined;
    }

    ensureWallet(accountId: AccountId): Wallet {
        const normalized = ExchangeHub.#normalizeAccountId(accountId);

        if (!normalized) {
            throw new Error('AccountId must be a non-empty string');
        }

        let wallet = this.#wallets.get(normalized);

        if (!wallet) {
            wallet = new Wallet(normalized);
            this.#wallets.set(normalized, wallet);
        }

        return wallet;
    }

    async connect() {
        return this.#core.connect();
    }

    async disconnect() {
        return this.#core.disconnect();
    }

    static #normalizeAccountId(accountId: AccountId): AccountId | undefined {
        if (typeof accountId !== 'string') {
            return undefined;
        }

        const normalized = accountId.trim();

        return normalized || undefined;
    }
}
