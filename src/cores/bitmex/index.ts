import { BitMexTransport } from './transport.js';
import { channelMessageHandlers } from './channelMessageHandlers/index.js';
import { isChannelMessage, isSubscribeMessage, isWelcomeMessage } from './utils.js';

import { BaseCore } from '../BaseCore.js';
import { getUnifiedSymbolAliases } from '../../utils/symbolMapping.js';
import { Instrument } from '../../domain/instrument.js';
import type { Settings } from '../../types.js';
import type { ExchangeHub } from '../../ExchangeHub.js';
import type {
  BitMexChannel,
  BitMexChannelMessage,
  BitMexSubscribeMessage,
  BitMexWelcomeMessage,
} from './types.js';

export class BitMex extends BaseCore<'BitMex'> {
  #settings: Settings;
  #transport: BitMexTransport;
  #symbolMappingEnabled: boolean;
  #instruments = new Map<string, Instrument>();
  #instrumentsByNative = new Map<string, Instrument>();
  #instrumentKeys = new WeakMap<Instrument, Set<string>>();

  constructor(shell: ExchangeHub<'BitMex'>, settings: Settings) {
    super(shell, settings);

    this.#settings = settings;
    this.#symbolMappingEnabled = settings.symbolMappingEnabled ?? true;
    this.#transport = new BitMexTransport(settings.isTest ?? false, (message) =>
      this.#handleMessage(message),
    );
  }

  override get instruments(): Map<string, Instrument> {
    return this.#instruments;
  }

  get symbolMappingEnabled(): boolean {
    return this.#symbolMappingEnabled;
  }

  resetInstrumentCache(): void {
    this.#instruments.clear();
    this.#instrumentsByNative.clear();
    this.#instrumentKeys = new WeakMap();
  }

  registerInstrument(instrument: Instrument): void {
    const existing = this.#instrumentsByNative.get(instrument.symbolNative);

    if (existing && existing !== instrument) {
      this.#removeInstrumentKeys(existing);
    }

    this.#instrumentsByNative.set(instrument.symbolNative, instrument);
    this.#registerInstrumentKeys(instrument);
  }

  getInstrumentByNative(symbol: string): Instrument | undefined {
    return this.#instrumentsByNative.get(symbol);
  }

  refreshInstrumentKeys(instrument: Instrument): void {
    this.#registerInstrumentKeys(instrument);
  }

  removeInstrument(symbol: string): void {
    const instrument = this.#instrumentsByNative.get(symbol);

    if (!instrument) {
      return;
    }

    this.#instrumentsByNative.delete(symbol);
    this.#removeInstrumentKeys(instrument);
  }

  #registerInstrumentKeys(instrument: Instrument): void {
    const existingKeys = this.#instrumentKeys.get(instrument);

    if (existingKeys) {
      for (const key of existingKeys) {
        this.#instruments.delete(key);
      }

      existingKeys.clear();
    }

    const keys = existingKeys ?? new Set<string>();

    const registerKey = (key: string | undefined) => {
      if (!key) {
        return;
      }

      const variants = new Set<string>([key, key.toLowerCase(), key.toUpperCase()]);

      for (const variant of variants) {
        keys.add(variant);
        this.#instruments.set(variant, instrument);
      }
    };

    registerKey(instrument.symbolNative);

    if (this.#symbolMappingEnabled) {
      for (const alias of getUnifiedSymbolAliases(instrument.symbolUni)) {
        registerKey(alias);
      }
    }

    this.#instrumentKeys.set(instrument, keys);
  }

  #removeInstrumentKeys(instrument: Instrument): void {
    const keys = this.#instrumentKeys.get(instrument);

    if (!keys) {
      return;
    }

    for (const key of keys) {
      this.#instruments.delete(key);
    }

    this.#instrumentKeys.delete(instrument);
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

    console.warn(message);
    throw new Error('Unknown message');
  }

  #handleWelcomeMessage(_message: BitMexWelcomeMessage) {}

  #handleSubscribeMessage(_message: BitMexSubscribeMessage) {}

  #handleChannelMessage<Channel extends BitMexChannel>(message: BitMexChannelMessage<Channel>) {
    const { table, action, data } = message;

    channelMessageHandlers[table][action](this, data);
  }
}
