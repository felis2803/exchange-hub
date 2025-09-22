export interface PrivateResubscribeFlow {
    /** вызывается транспортом после события 'authed' */
    onAuthedResubscribe(): Promise<void>;
}

export class DefaultPrivateResubscribeFlow implements PrivateResubscribeFlow {
    #doResubscribe: () => Promise<void>;

    constructor(doResubscribe: () => Promise<void>) {
        this.#doResubscribe = doResubscribe;
    }

    async onAuthedResubscribe(): Promise<void> {
        await this.#doResubscribe();
    }
}
