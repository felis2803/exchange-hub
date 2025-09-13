export const BITMEX_PUBLIC_CHANNELS = [
    'instrument',
    'trade',
    'funding',
    'liquidation',
    'orderBookL2',
    'settlement',
] as const;

export const BITMEX_PRIVATE_CHANNELS = ['execution', 'order', 'margin', 'position', 'transact', 'wallet'] as const;

export type BitMexPublicChannel = (typeof BITMEX_PUBLIC_CHANNELS)[number];
export type BitMexPrivateChannel = (typeof BITMEX_PRIVATE_CHANNELS)[number];
export type BitMexChannel = BitMexPublicChannel | BitMexPrivateChannel;
