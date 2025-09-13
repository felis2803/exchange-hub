import type { ExchangeHub } from '../ExchangeHub';
import type { Instrument } from '../entities';
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

    get apiKey(): ApiKey | undefined {
        return this.#apiKey;
    }

    get apiSec(): ApiSec | undefined {
        return this.#apiSec;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    async connect(): Promise<void> {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    async disconnect(): Promise<void> {}

    get instruments(): Instrument[] {
        return [];
    }
}
