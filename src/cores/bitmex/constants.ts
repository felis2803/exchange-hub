export const BITMEX_PUBLIC_CHANNELS = [
    'instrument',
    'trade',
    'funding',
    'liquidation',
    'orderBookL2',
    'settlement',
] as const;

export const BITMEX_PRIVATE_CHANNELS = ['execution', 'order', 'margin', 'position', 'transact', 'wallet'] as const;
