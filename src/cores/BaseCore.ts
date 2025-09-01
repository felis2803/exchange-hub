import type { ExchangeHub } from '../ExchangeHub';
import type { Instrument, Order } from '../entities';
import type { ApiKey, ApiSec, ExchangeName, Settings } from '../types';

export class BaseCore {
    #shell: ExchangeHub<ExchangeName>;
    #isTest = false;
    #apiKey?: ApiKey;
    #apiSec?: ApiSec;

    constructor(shell: ExchangeHub<ExchangeName>, settings: Settings) {
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    async connect(): Promise<void> {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    async disconnect(): Promise<void> {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getInstruments(): Promise<Instrument[]> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getOrders(_instrument: Instrument): Promise<Order[]> {
        return [];
    }
}
