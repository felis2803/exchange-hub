import type { Instrument } from '../entities/createInstrument';
import type { ExchangeHub } from '../ExchangeHub';
import type { ApiKey, ApiSec, ExchangeName, Settings } from '../types';

export class BaseCore<ExName extends ExchangeName> {
    #shell: ExchangeHub<ExName>;
    #isTest = false;
    #apiKey?: ApiKey;
    #apiSec?: ApiSec;
    #instruments: Instrument<ExName>;

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

    get instruments() {
        return this.#instruments;
    }

    async connect(): Promise<void> {
        throw new Error('Not implemented!');
    }

    async disconnect(): Promise<void> {
        throw new Error('Not implemented!');
    }
}
