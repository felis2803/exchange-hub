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

export const BITMEX_REST_ENDPOINTS = {
  testnet: 'https://testnet.bitmex.com/api/v1',
  mainnet: 'https://www.bitmex.com/api/v1',
} as const;

export const BITMEX_WS_ENDPOINTS = {
  mainnet: 'wss://www.bitmex.com/realtime',
  testnet: 'wss://testnet.bitmex.com/realtime',
} as const;

export const WS_PING_INTERVAL_MS = 25_000; // 25s
export const WS_PONG_TIMEOUT_MS = 15_000; // 15s
export const WS_RECONNECT_MAX_ATTEMPTS = 12;
export const WS_RECONNECT_BASE_DELAY_MS = 200; // min 200ms
export const WS_RECONNECT_MAX_DELAY_MS = 10 * 60 * 1000; // 10min
export const WS_SEND_BUFFER_LIMIT = 1_000;
