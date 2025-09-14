export const BITMEX_PUBLIC_CHANNELS = [
    'instrument',
    'trade',
    'liquidation',
    'orderBookL2',
    'settlement',
] as const;

export const BITMEX_PRIVATE_CHANNELS = ['execution', 'order', 'margin', 'position', 'transact', 'wallet'] as const;

export const BITMEX_CHANNELS = [...BITMEX_PUBLIC_CHANNELS, ...BITMEX_PRIVATE_CHANNELS] as const;
