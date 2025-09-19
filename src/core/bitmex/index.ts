import { BitMexTransport } from './transport.js';
import { channelMessageHandlers } from './channelMessageHandlers/index.js';
import { isChannelMessage, isSubscribeMessage, isWelcomeMessage } from './utils.js';
import { L2_CHANNEL, L2_MAX_DEPTH_HINT } from './constants.js';
import { markOrderChannelAwaitingSnapshot } from './channels/order.js';

import { BaseCore } from '../BaseCore.js';
import { getUnifiedSymbolAliases, mapSymbolNativeToUni } from '../../utils/symbolMapping.js';
import { Instrument } from '../../domain/instrument.js';
import { createLogger } from '../../infra/logger.js';
import type { Settings } from '../../types.js';
import type { ExchangeHub } from '../../ExchangeHub.js';
import type {
  BitMexChannel,
  BitMexChannelMessage,
  BitMexSubscribeMessage,
  BitMexWelcomeMessage,
} from './types.js';

export class BitMex extends BaseCore<'BitMex'> {
  #log = createLogger('bitmex:core');
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
    if (!(instrument instanceof Instrument)) {
      throw new TypeError('Expected Instrument instance');
    }

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

  resolveInstrument(symbol: string): Instrument | undefined {
    if (typeof symbol !== 'string') {
      return undefined;
    }

    const normalized = symbol.trim();

    if (!normalized) {
      return undefined;
    }

    const direct =
      this.getInstrumentByNative(normalized) ??
      this.instruments.get(normalized) ??
      this.instruments.get(normalized.toLowerCase()) ??
      this.instruments.get(normalized.toUpperCase());

    if (direct) {
      return direct;
    }

    const unified = mapSymbolNativeToUni(normalized, { enabled: this.#symbolMappingEnabled });

    if (!unified) {
      return undefined;
    }

    return (
      this.instruments.get(unified) ??
      this.instruments.get(unified.toLowerCase()) ??
      this.instruments.get(unified.toUpperCase())
    );
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

  override resubscribeOrderBook(symbol: string): void {
    const normalized = typeof symbol === 'string' ? symbol.trim() : '';

    if (!normalized) {
      return;
    }

    const channelPrefix = L2_MAX_DEPTH_HINT > 0 ? `${L2_CHANNEL}_${L2_MAX_DEPTH_HINT}` : L2_CHANNEL;
    const channel = `${channelPrefix}:${normalized}`;

    this.#log.warn('BitMEX orderBookL2 resubscribe requested for %s', normalized);

    this.#transport.send({ op: 'unsubscribe', args: [channel] });
    this.#transport.send({ op: 'subscribe', args: [channel] });
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

  #handleSubscribeMessage(message: BitMexSubscribeMessage) {
    if (!message.success) {
      return;
    }

    const requested = new Set(message.request?.args ?? []);

    if (message.subscribe === 'order' || requested.has('order')) {
      markOrderChannelAwaitingSnapshot(this);
    }
  }

  #handleChannelMessage<Channel extends BitMexChannel>(message: BitMexChannelMessage<Channel>) {
    const { table, action, data } = message;

    channelMessageHandlers[table][action](this, data);
  }
}
