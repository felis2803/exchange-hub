// Margin.d.ts
import { IEntity } from './Entity';

export type MarginLevel = number;

export interface IMargin extends IEntity {
    level: MarginLevel;

    // Методы для управления маржинальными показателями
}
