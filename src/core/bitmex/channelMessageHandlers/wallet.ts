import { handleWalletDelete, handleWalletInsert, handleWalletPartial, handleWalletUpdate } from '../channels/wallet';
import type { BitMex } from '../index';
import type { BitMexWallet } from '../types';

export const wallet = {
    partial(core: BitMex, data: BitMexWallet[]) {
        handleWalletPartial(core, data);
    },

    insert(core: BitMex, data: BitMexWallet[]) {
        handleWalletInsert(core, data);
    },

    update(core: BitMex, data: BitMexWallet[]) {
        handleWalletUpdate(core, data);
    },

    delete(core: BitMex, data: BitMexWallet[]) {
        handleWalletDelete(core, data);
    },
};
