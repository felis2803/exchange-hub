import type { ExchangeName } from './types.js';

declare module './core/BaseCore' {
  interface BaseCore<ExName extends ExchangeName> {
    readonly instruments: Map<string, unknown>;
  }
}
