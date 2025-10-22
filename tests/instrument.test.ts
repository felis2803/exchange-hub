import { INSTRUMENT_STATUSES, INSTRUMENT_TYPES } from '../src/constants';

describe('Instrument fields', () => {
    it('The values of the Instrument fields must not overlap', () => {
        const typesSet = new Set(INSTRUMENT_TYPES);
        const statusesSet = new Set(INSTRUMENT_STATUSES);

        const intersection = typesSet.intersection(statusesSet);

        expect(intersection.size).toBe(0);
    });
});
