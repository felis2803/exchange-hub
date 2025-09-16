import type { ExchangeHub } from '../ExchangeHub.js';
import type { ExchangeName } from '../types.js';

export function createEntity<ExName extends ExchangeName>(eh: ExchangeHub<ExName>) {
    class Entity {
        static eh = eh;
    }

    return Entity;
}

export type EntityClass<ExName extends ExchangeName> = ReturnType<typeof createEntity<ExName>>;
