import {
  assertEndAfterStart,
  assertHiredAfterMinimumAge,
  assertNotInFuture,
} from './date-rules.util';

describe('coherence des dates (rapport A03, A07)', () => {
  it('refuse une date de naissance ou d incident dans le futur, accepte aujourd hui', () => {
    const nextYear = `${new Date().getFullYear() + 1}-06-15`;
    expect(() => assertNotInFuture(nextYear, 'La date de naissance')).toThrow(
      'La date de naissance ne peut pas être dans le futur.',
    );
    expect(() => assertNotInFuture(new Date(), 'La date')).not.toThrow();
    expect(() => assertNotInFuture(undefined, 'La date')).not.toThrow();
  });

  it('refuse une fin de contrat avant (ou egale a) son debut', () => {
    expect(() => assertEndAfterStart('2026-10-21', '2026-01-01')).toThrow(
      'La date de fin doit être postérieure à la date de début.',
    );
    expect(() => assertEndAfterStart('2026-10-21', '2026-10-21')).toThrow();
    expect(() => assertEndAfterStart('2026-10-21', '2027-07-31')).not.toThrow();
    expect(() => assertEndAfterStart('2026-10-21', undefined)).not.toThrow();
  });

  it('refuse une embauche avant 16 ans', () => {
    expect(() =>
      assertHiredAfterMinimumAge('2000-05-10', '1999-01-01'),
    ).toThrow(/16 ans/);
    expect(() =>
      assertHiredAfterMinimumAge('2000-05-10', '2016-05-09'),
    ).toThrow();
    expect(() =>
      assertHiredAfterMinimumAge('2000-05-10', '2016-05-10'),
    ).not.toThrow();
  });
});
