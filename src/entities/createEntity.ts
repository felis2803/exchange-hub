import type { ExchangeHub } from '../ExchangeHub';
import type { ExchangeName } from '../types';

export function createEntity<ExName extends ExchangeName>(eh: ExchangeHub<ExName>) {
    class Entity {
        static #eh = eh;

        get eh(): ExchangeHub<ExName> {
            return Entity.#eh;
        }
    }

    return Entity;
}

export type EntityClass<ExName extends ExchangeName> = ReturnType<typeof createEntity<ExName>>;
