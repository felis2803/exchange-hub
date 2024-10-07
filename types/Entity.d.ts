// Entity.d.ts
import { EventEmitter } from 'events';

export interface IEntity extends EventEmitter {
    id?: string;
    name?: string;
    // Дополнительные свойства или методы для всех сущностей
}
