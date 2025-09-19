export interface PrivateResubscribeFlow {
  /** вызывается транспортом после события 'authed' */
  onAuthedResubscribe(): Promise<void>;
}

export class DefaultPrivateResubscribeFlow implements PrivateResubscribeFlow {
  constructor(private readonly doResubscribe: () => Promise<void>) {}

  async onAuthedResubscribe(): Promise<void> {
    await this.doResubscribe();
  }
}
