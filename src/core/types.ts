export type Symbol = string;
export type AccountId = string;
export type OrderID = string;
export type ClOrdID = string;
export type TimestampISO = string;
export type Liquidity = 'maker' | 'taker';

export interface DomainUpdate<T> {
  prev: T;
  next: T;
  changed: (keyof T)[];
}

export interface BaseEntity<TSnapshot> {
  getSnapshot(): TSnapshot;
  on(
    event: 'update',
    handler: (next: TSnapshot, diff: DomainUpdate<TSnapshot>, reason?: string) => void,
  ): this;
  off(
    event: 'update',
    handler: (next: TSnapshot, diff: DomainUpdate<TSnapshot>, reason?: string) => void,
  ): this;
}
