import { dedupeByKey } from '../../../src/infra/dedupe.js';

describe('dedupeByKey', () => {
    test('Дедуп по ключу возвращает первый экземпляр', () => {
        const input = [
            { id: 'a', value: 1 },
            { id: 'b', value: 2 },
            { id: 'a', value: 3 },
            { id: 'c', value: 4 },
            { id: 'b', value: 5 },
        ];

        const result = dedupeByKey(input, item => item.id);

        expect(result).toHaveLength(3);
        expect(result[0]).toBe(input[0]);
        expect(result[1]).toBe(input[1]);
        expect(result[2]).toBe(input[3]);
    });

    test('Пустой массив → пустой результат', () => {
        expect(dedupeByKey([], () => 'noop')).toEqual([]);
    });
});
