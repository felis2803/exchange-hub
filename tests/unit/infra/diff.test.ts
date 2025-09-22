import { diffKeys } from '../../../src/infra/diff.js';

describe('diffKeys', () => {
    test('Изменение простых полей попадает в changed', () => {
        const prev = { balance: 100, status: 'ok', currency: 'USD' };
        const next = { balance: 150, status: 'stale', currency: 'USD' };

        const changed = diffKeys(prev, next);

        expect(changed.sort()).toEqual(['balance', 'status']);
    });

    test('Глубокие объекты сравниваются по JSON.stringify (ожидаемое поведение зафиксировать)', () => {
        const prev = { meta: { a: 1, b: 2 } };
        const next = { meta: { b: 2, a: 1 } };

        const changed = diffKeys(prev, next);

        expect(changed).toEqual(['meta']);
    });
});
