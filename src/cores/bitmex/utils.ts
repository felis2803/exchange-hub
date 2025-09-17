import type {
  BitMexChannel,
  BitMexChannelMessage,
  BitMexSubscribeMessage,
  BitMexWelcomeMessage,
} from './types.js';

export function isWelcomeMessage(message: any): message is BitMexWelcomeMessage {
  return typeof message?.info === 'string' && 'version' in message;
}

export function isSubscribeMessage(message: any): message is BitMexSubscribeMessage {
  return typeof message?.success === 'boolean' && 'subscribe' in message;
}

export function isChannelMessage(message: any): message is BitMexChannelMessage<BitMexChannel> {
  return typeof message?.table === 'string' && typeof message?.action === 'string';
}
