// EntityMap.d.ts
import { IEntity } from './Entity';

export interface IEntityMap<K extends string, V extends IEntity>
    extends Map<K, V> {
    // Общие методы или свойства для EntityMap
}
