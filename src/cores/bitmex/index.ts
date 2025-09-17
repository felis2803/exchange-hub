import { BitMexTransport } from './transport';
import { channelMessageHandlers } from './channelMessageHandlers';
import { isChannelMessage, isSubscribeMessage, isWelcomeMessage } from './utils';

import { BaseCore } from '../BaseCore';
import type { Settings } from '../../types';
import type { ExchangeHub } from '../../ExchangeHub';
import type {
  BitMexChannel,
  BitMexChannelMessage,
  BitMexSubscribeMessage,
  BitMexWelcomeMessage,
  BitMexInstrument,
} from './types';

export class BitMex extends BaseCore<'BitMex'> {
  #settings: Settings;
  #transport: BitMexTransport;
  #instruments = new Map<string, BitMexInstrument>();

  constructor(shell: ExchangeHub<'BitMex'>, settings: Settings) {
    super(shell, settings);

    this.#settings = settings;
    this.#transport = new BitMexTransport(settings.isTest ?? false, (message) =>
      this.#handleMessage(message),
    );
  }

  override get instruments(): Map<string, BitMexInstrument> {
    return this.#instruments;
  }

  async connect(): Promise<void> {
    await this.#transport.connect(this.#settings.apiKey, this.#settings.apiSec);
  }

  async disconnect(): Promise<void> {
    await this.#transport.disconnect();
  }

  #handleMessage(message: unknown) {
    if (isChannelMessage(message)) {
      return this.#handleChannelMessage(message);
    }

    if (isSubscribeMessage(message)) {
      return this.#handleSubscribeMessage(message);
    }

    if (isWelcomeMessage(message)) {
      return this.#handleWelcomeMessage(message);
    }

    console.log(message);
    throw new Error('Unknown message');
  }

  #handleWelcomeMessage(_message: BitMexWelcomeMessage) {}

  #handleSubscribeMessage(_message: BitMexSubscribeMessage) {}

  #handleChannelMessage<Channel extends BitMexChannel>(message: BitMexChannelMessage<Channel>) {
    const { table, action, data } = message;

    channelMessageHandlers[table][action](this, data);
  }
}
