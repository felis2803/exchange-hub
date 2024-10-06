export class BaseCore {
    constructor(
        protected credentials?: { apiKey: string; apiSecret: string },
    ) {}

    async connect(): Promise<void> {
        throw new Error('connect method not implemented');
    }

    async disconnect(): Promise<void> {
        throw new Error('disconnect method not implemented');
    }
}
