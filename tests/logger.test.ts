import { createLogger } from '../src/infra/logger.js';

describe('logger (smoke)', () => {
  test('create logger and log at all levels without throwing', () => {
    const log = createLogger('jest-smoke');
    expect(() => log.trace('trace %s', 'ok', { ctx: 1 })).not.toThrow();
    expect(() => log.debug('debug %d', 2)).not.toThrow();
    expect(() => log.info('info')).not.toThrow();
    expect(() => log.warn('warn', { warn: true })).not.toThrow();
    expect(() => log.error('error')).not.toThrow();
  });
});
