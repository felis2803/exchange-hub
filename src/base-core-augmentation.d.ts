import type { ExchangeName } from './types';

declare module './cores/BaseCore' {
  interface BaseCore<ExName extends ExchangeName> {
    readonly instruments: Map<string, unknown>;
  }
}
