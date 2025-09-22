import { createLogger } from '../infra/logger.js';
import type { ExchangeHub } from '../ExchangeHub.js';
import type { ApiKey, ApiSec, ExchangeName, Settings } from '../types.js';

const log = createLogger('core:base');

export class BaseCore<ExName extends ExchangeName> {
    #shell: ExchangeHub<ExName>;
    #isTest = false;
    #apiKey?: ApiKey;
    #apiSec?: ApiSec;

    constructor(shell: ExchangeHub<ExName>, settings: Settings) {
        const { isTest, apiKey, apiSec } = settings;

        this.#shell = shell;

        this.#isTest = isTest ?? false;
        this.#apiKey = apiKey;
        this.#apiSec = apiSec;
    }

    get shell() {
        return this.#shell;
    }

    get isTest(): boolean {
        return this.#isTest;
    }

    get isPublicOnly(): boolean {
        return !(this.#apiKey && this.#apiSec);
    }

    get apiKey(): ApiKey | undefined {
        return this.#apiKey;
    }

    get apiSec(): ApiSec | undefined {
        return this.#apiSec;
    }

    async connect(): Promise<void> {
        throw new Error('Not implemented!');
    }

    async disconnect(): Promise<void> {
        throw new Error('Not implemented!');
    }

    resubscribeOrderBook(symbol: string): void {
        const normalized = typeof symbol === 'string' ? symbol.trim() : '';

        log.warn('Order book resubscribe stub invoked', {
            symbol: normalized || null,
        });
    }
}
