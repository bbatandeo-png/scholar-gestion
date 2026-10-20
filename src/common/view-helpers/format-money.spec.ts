import { formatDay } from './format-day';
import { formatAmount, formatMoney } from './format-money';

describe('formatage des montants', () => {
  it('groupe les milliers a la francaise avec une espace insecable fine', () => {
    expect(formatAmount(125000)).toBe('125 000');
    expect(formatAmount(1234567)).toBe('1 234 567');
    expect(formatAmount(999)).toBe('999');
    expect(formatAmount(0)).toBe('0');
  });

  it('n affiche les decimales que si elles existent, avec une virgule', () => {
    expect(formatAmount(12500.5)).toBe('12 500,50');
    expect(formatAmount(12500.456)).toBe('12 500,46');
    expect(formatAmount(75000.0)).toBe('75 000');
  });

  it('accepte les montants en texte, negatifs, et ignore les valeurs vides ou invalides', () => {
    expect(formatAmount('85000')).toBe('85 000');
    expect(formatAmount(-1500)).toBe('-1 500');
    expect(formatAmount(null)).toBe('');
    expect(formatAmount(undefined)).toBe('');
    expect(formatAmount('')).toBe('');
    expect(formatAmount('abc')).toBe('');
  });

  it('ajoute la devise FCFA, separee par une espace insecable', () => {
    expect(formatMoney(125000)).toBe('125 000 FCFA');
    expect(formatMoney(null)).toBe('');
  });

  it('utilise des espaces ordinaires pour les PDF', () => {
    expect(formatAmount(125000, { plainSpaces: true })).toBe('125 000');
    expect(formatMoney(1234567.5, { plainSpaces: true })).toBe(
      '1 234 567,50 FCFA',
    );
  });
});

describe('formatage des dates courtes', () => {
  it('affiche jj/mm/aaaa en UTC, sans decalage de fuseau', () => {
    expect(formatDay(new Date('2026-10-07T00:00:00.000Z'))).toBe('07/10/2026');
    expect(formatDay('2026-01-31')).toBe('31/01/2026');
    expect(formatDay(null)).toBe('');
    expect(formatDay('pas une date')).toBe('');
  });
});
