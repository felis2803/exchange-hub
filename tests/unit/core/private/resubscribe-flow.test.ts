import { DefaultPrivateResubscribeFlow } from '../../../../src/core/private/resubscribe-flow';
import { asyncNoop } from '../../../../src/utils/noop';

describe('DefaultPrivateResubscribeFlow', () => {
    test('DefaultPrivateResubscribeFlow вызывает doResubscribe() ровно один раз на вызов onAuthedResubscribe()', async () => {
        const doResubscribe = jest.fn(asyncNoop);
        const flow = new DefaultPrivateResubscribeFlow(doResubscribe);

        await flow.onAuthedResubscribe();
        expect(doResubscribe).toHaveBeenCalledTimes(1);

        await flow.onAuthedResubscribe();
        expect(doResubscribe).toHaveBeenCalledTimes(2);
    });

    test('Ошибки doResubscribe пробрасываются вызывающему коду', async () => {
        const error = new Error('resubscribe failed');
        const flow = new DefaultPrivateResubscribeFlow(async () => {
            throw error;
        });

        await expect(flow.onAuthedResubscribe()).rejects.toThrow(error);
    });
});
