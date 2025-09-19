import { sign } from '../../src/core/bitmex/rest/sign.js';

describe('BitMEX REST sign()', () => {
  test('matches known signature from BitMEX docs', () => {
    const hex = sign('GET', '/api/v1/instrument', 1518064236, '', 'secret');
    expect(hex).toBe('0b4b0b0b49be3efa4c18d67e198a2b5b838d60bd1eb8f6b00214c74d0031728a');
  });
});
