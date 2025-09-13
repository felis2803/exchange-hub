import type { ExchangeHub } from '../ExchangeHub';

export const createEntity = (hub: ExchangeHub<any>) => {
    class Entity {
        static hub = hub;
    }

    return Entity;
};

export type EntityClass = ReturnType<typeof createEntity>;
