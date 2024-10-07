// Position.d.ts
import { IEntity } from './Entity';

export type PositionVolume = number;

export interface IPosition extends IEntity {
    volume: PositionVolume;

    close(): Promise<void>;
}
