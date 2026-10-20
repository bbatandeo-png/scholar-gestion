import { FinalDecision } from '../common/enums/domain.enums';
import { parseDecision } from './promotions.controller';

describe('parseDecision (import Excel du passage annuel)', () => {
  it.each([
    ['Admis', FinalDecision.PROMOTED],
    ['admise', FinalDecision.PROMOTED],
    ['REDOUBLE', FinalDecision.REPEATED],
    ['Transféré', FinalDecision.TRANSFERRED],
    ['Quitte l’école', FinalDecision.LEFT],
    ["quitte l'ecole", FinalDecision.LEFT],
    ['Archivé', FinalDecision.ARCHIVED],
    ['promoted', FinalDecision.PROMOTED],
    ['left', FinalDecision.LEFT],
  ])('comprend « %s »', (raw, expected) => {
    expect(parseDecision(raw)).toBe(expected);
  });

  it('ignore une valeur vide, inconnue ou « pending »', () => {
    expect(parseDecision('')).toBe('');
    expect(parseDecision('peut-être')).toBe('');
    expect(parseDecision('pending')).toBe('');
  });
});
