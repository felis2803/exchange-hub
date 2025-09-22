import { isNewerByTimestamp, normalizeWsTs, parseIsoTs, toIso } from '../../../src/infra/time';

describe('time utils', () => {
    test('toIso/parseIsoTs обратимы в пределах миллисекунд', () => {
        const nowMs = Date.now();
        const isoFromNumber = toIso(nowMs);
        const roundtripMs = parseIsoTs(isoFromNumber);

        expect(Math.abs(roundtripMs - nowMs)).toBeLessThanOrEqual(1);

        const date = new Date(nowMs);
        const isoFromDate = toIso(date);
        const roundtripDate = parseIsoTs(isoFromDate);

        expect(roundtripDate).toBe(date.getTime());
    });

    test('isNewerByTimestamp корректно сравнивает ISO-строки', () => {
        const base = '2024-05-05T08:00:00.000Z';
        const older = '2024-05-05T07:59:59.999Z';
        const newer = '2024-05-05T08:00:00.001Z';

        expect(isNewerByTimestamp(undefined, base)).toBe(true);
        expect(isNewerByTimestamp(base, undefined)).toBe(false);
        expect(isNewerByTimestamp(base, newer)).toBe(true);
        expect(isNewerByTimestamp(base, older)).toBe(false);
        expect(isNewerByTimestamp(base, base)).toBe(true);
    });

    test('normalizeWsTs поддерживает number|ISO', () => {
        const msValue = 1_715_000_000_000;
        const isoValue = '2024-05-05T08:00:00Z';
        const numericAsString = `${msValue}`;

        expect(normalizeWsTs(msValue)).toBe(new Date(msValue).toISOString());
        expect(normalizeWsTs(isoValue)).toBe(new Date(isoValue).toISOString());
        expect(normalizeWsTs(numericAsString)).toBe(new Date(msValue).toISOString());
        expect(normalizeWsTs(undefined)).toBeUndefined();
        expect(normalizeWsTs(null as unknown as undefined)).toBeUndefined();
        expect(normalizeWsTs('invalid')).toBeUndefined();
    });
});
