export const ASSET_TYPES = ['currency', 'crypto_currency', 'index'];

export const INSTRUMENT_TYPES = ['spot', 'swap'] as const;

export const INSTRUMENT_STATUSES = ['active', 'delisted', 'expired'] as const;

export const ORDER_TYPES = ['market', 'limit', 'stop', 'trigger'] as const;

export const ORDER_STATUSES = [
    'new',
    'placing',
    'placed',
    'rejected',
    'partiallyFilled',
    'filled',
    'canceling',
    'canceled',
] as const;
