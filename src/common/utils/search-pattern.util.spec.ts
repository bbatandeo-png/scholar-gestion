import { accentInsensitiveRegExp } from './search-pattern.util';

describe('recherche sans accents (rapport A09)', () => {
  it('trouve « Éléonore » en tapant « eleonore »', () => {
    expect(accentInsensitiveRegExp('eleonore').test('Éléonore')).toBe(true);
    expect(accentInsensitiveRegExp('ÉLÉONORE').test('eleonore')).toBe(true);
    expect(accentInsensitiveRegExp('almeida').test("D'Almeïda")).toBe(true);
  });

  it('cherche les caracteres speciaux tels quels, sans erreur', () => {
    expect(() => accentInsensitiveRegExp('(test')).not.toThrow();
    expect(accentInsensitiveRegExp('a.b').test('axb')).toBe(false);
    expect(accentInsensitiveRegExp('a.b').test('a.b')).toBe(true);
  });
});
