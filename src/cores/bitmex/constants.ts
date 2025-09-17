export const BITMEX_PUBLIC_CHANNELS = [
  'instrument',
  'trade',
  'liquidation',
  'orderBookL2',
  'settlement',
] as const;

export const BITMEX_PRIVATE_CHANNELS = [
  'execution',
  'order',
  'margin',
  'position',
  'transact',
  'wallet',
] as const;

export const BITMEX_CHANNELS = [...BITMEX_PUBLIC_CHANNELS, ...BITMEX_PRIVATE_CHANNELS] as const;

export const BITMEX_WS_ENDPOINTS = {
  testnet: 'wss://testnet.bitmex.com/realtime',
  mainnet: 'wss://www.bitmex.com/realtime',
} as const;

export const BITMEX_REST_ENDPOINTS = {
  testnet: 'https://testnet.bitmex.com/api/v1',
  mainnet: 'https://www.bitmex.com/api/v1',
} as const;
