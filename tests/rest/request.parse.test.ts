import { jest } from '@jest/globals';

describe('BitmexRestClient safe JSON parsing', () => {
    const originalFetch = global.fetch;
    const originalLogLevel = process.env.EXH_LOG_LEVEL;

    afterEach(() => {
        global.fetch = originalFetch;

        if (originalLogLevel === undefined) {
            delete process.env.EXH_LOG_LEVEL;
        } else {
            process.env.EXH_LOG_LEVEL = originalLogLevel;
        }

        jest.restoreAllMocks();
        jest.resetModules();
    });

    test('emits debug log when JSON parse fails and falls back to text', async () => {
        process.env.EXH_LOG_LEVEL = 'debug';
        jest.resetModules();

        const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true as unknown as number);
        const parseSpy = jest.spyOn(JSON, 'parse').mockImplementation(() => {
            throw new Error('invalid json');
        });

        const { BitmexRestClient } = await import('../../src/core/bitmex/rest/request.js');

        const mockFetch = jest.fn(async () => new Response('not-json', { status: 200 }));

        global.fetch = mockFetch as unknown as typeof fetch;

        const client = new BitmexRestClient({ isTest: true });
        const result = await client.request('GET', '/api/v1/instrument/active');

        expect(result).toBeUndefined();
        expect(parseSpy).toHaveBeenCalled();
        expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('bitmex response json parse failed'));
        expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"note":"falling back to text"'));
    });
});
