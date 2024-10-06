import { BaseCore } from '../BaseCore';

export class BitmexCore extends BaseCore {
    async connect(): Promise<void> {
        // Implement connection logic to Bitmex
        console.log('Connecting to Bitmex...');
    }

    async disconnect(): Promise<void> {
        // Implement disconnection logic from Bitmex
        console.log('Disconnecting from Bitmex...');
    }
}
