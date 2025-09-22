/* Согласованные имена метрик/лейблы для приватных каналов */
export const METRICS = {
    walletUpdateCount: 'wallet_update_count',
    positionUpdateCount: 'position_update_count',
    orderUpdateCount: 'order_update_count',
    snapshotAgeSec: 'wallet_snapshot_age_sec',
    privateLatencyMs: 'private_latency_ms',
} as const;

export type PrivateLabels = {
    env: 'testnet' | 'mainnet';
    table: 'wallet' | 'position' | 'order';
    symbol?: string;
};
