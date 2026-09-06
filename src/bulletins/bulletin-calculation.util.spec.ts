import { SubjectCategory } from '../common/enums/domain.enums';
import {
  appreciationFor,
  averageOfPresent,
  computeGroupAverage,
  computeStudentPeriodTotals,
  computeSubjectAverages,
  rankBy,
} from './bulletin-calculation.util';

describe('averageOfPresent', () => {
  it('averages every value when all are present, 0 counts as a real grade', () => {
    expect(averageOfPresent([12, 0, 12])).toBe(8);
  });

  it('excludes null/undefined from both the sum and the denominator', () => {
    expect(averageOfPresent([null, 13, 12])).toBe(12.5);
    expect(averageOfPresent([undefined, 12])).toBe(12);
  });

  it('returns null when nothing is present', () => {
    expect(averageOfPresent([null, null, undefined])).toBeNull();
  });
});

describe('computeSubjectAverages', () => {
  it('matches the worked example from the cahier des charges (Anglais)', () => {
    const result = computeSubjectAverages({
      i1: 6,
      i2: 11,
      devoir: 10,
      compo: 11,
      coefficient: 2,
    });
    expect(result).toEqual({
      moyenneClasse: 9,
      moyennePeriode: 10,
      moyenneDefinitive: 20,
    });
  });

  it('falls back to Moy. Classe alone when Compo is missing', () => {
    const result = computeSubjectAverages({
      i1: 12,
      i2: null,
      devoir: 12,
      compo: null,
      coefficient: 1,
    });
    expect(result.moyenneClasse).toBe(12);
    expect(result.moyennePeriode).toBe(12);
    expect(result.moyenneDefinitive).toBe(12);
  });

  it('reproduces the three-option "notes manquantes" example from the cahier des charges', () => {
    // Option 1: i1=12, i2=13, devoir=12 -> (12+13+12)/3 = 12.33. The cahier
    // des charges itself states "=13,33" here, which is an arithmetic typo
    // in the source document (12+13+12=37, 37/3=12.33, not 13.33) - the
    // formula it describes is unambiguous and this is its correct result.
    expect(
      computeSubjectAverages({
        i1: 12,
        i2: 13,
        devoir: 12,
        compo: null,
        coefficient: 1,
      }).moyenneClasse,
    ).toBe(12.33);
    // Option 2: i1 missing, i2=13, devoir=12 -> (13+12)/2 = 12.50
    expect(
      computeSubjectAverages({
        i1: null,
        i2: 13,
        devoir: 12,
        compo: null,
        coefficient: 1,
      }).moyenneClasse,
    ).toBe(12.5);
    // Option 3: only devoir=12 -> 12.00
    expect(
      computeSubjectAverages({
        i1: null,
        i2: null,
        devoir: 12,
        compo: null,
        coefficient: 1,
      }).moyenneClasse,
    ).toBe(12);
  });

  it('returns every field null when the subject has no grade at all this period', () => {
    const result = computeSubjectAverages({
      i1: null,
      i2: null,
      devoir: null,
      compo: null,
      coefficient: 3,
    });
    expect(result).toEqual({
      moyenneClasse: null,
      moyennePeriode: null,
      moyenneDefinitive: null,
    });
  });
});

describe('appreciationFor', () => {
  const cases: Array<[number, string, string]> = [
    [5.99, 'Très faible', 'Travail très faible'],
    [6, 'Faible', 'Faible travail'],
    [6.99, 'Faible', 'Faible travail'],
    [7, 'Très insuffisant', 'Travail très insuffisant'],
    [9.99, 'Insuffisant', 'Travail insuffisant'],
    [10, 'Passable', 'Travail passable'],
    [11.99, 'Passable', 'Travail passable'],
    [12, 'Assez Bien', 'Assez bon travail'],
    [13.99, 'Assez Bien', 'Assez bon travail'],
    [14, 'Bien', 'Bon travail'],
    [15.99, 'Bien', 'Bon travail'],
    [16, 'Très Bien', 'Très bon travail'],
    [17.99, 'Très Bien', 'Très bon travail'],
    [18, 'Excellent(e)', 'Travail excellent'],
    [20, 'Excellent(e)', 'Travail excellent'],
  ];

  it.each(cases)(
    'value %s -> matiere "%s" / generale "%s"',
    (value, matiereLabel, generaleLabel) => {
      expect(appreciationFor(value, 'matiere')).toBe(matiereLabel);
      expect(appreciationFor(value, 'generale')).toBe(generaleLabel);
    },
  );
});

describe('rankBy', () => {
  type Item = { id: string; value: number | null; gender: string };

  it('ranks descending and applies standard 1-2-2-4 ties', () => {
    const items: Item[] = [
      { id: 'a', value: 15, gender: 'M' },
      { id: 'b', value: 18, gender: 'F' },
      { id: 'c', value: 18, gender: 'M' },
      { id: 'd', value: 10, gender: 'F' },
    ];
    const ranks = rankBy(
      items,
      (i) => i.id,
      (i) => i.value,
      (i) => i.gender,
    );
    expect(ranks.get('b')).toBe('1ère');
    expect(ranks.get('c')).toBe('1er');
    expect(ranks.get('a')).toBe('3ème');
    expect(ranks.get('d')).toBe('4ème');
  });

  it('gives every rank-1 student their own gendered label, not a single class-wide one', () => {
    const items: Item[] = [
      { id: 'a', value: 20, gender: 'F' },
      { id: 'b', value: 20, gender: 'M' },
    ];
    const ranks = rankBy(
      items,
      (i) => i.id,
      (i) => i.value,
      (i) => i.gender,
    );
    expect(ranks.get('a')).toBe('1ère');
    expect(ranks.get('b')).toBe('1er');
  });

  it('excludes items with a null value from the competition entirely', () => {
    const items: Item[] = [
      { id: 'a', value: 15, gender: 'M' },
      { id: 'b', value: null, gender: 'F' },
    ];
    const ranks = rankBy(
      items,
      (i) => i.id,
      (i) => i.value,
      (i) => i.gender,
    );
    expect(ranks.get('a')).toBe('1er');
    expect(ranks.get('b')).toBeNull();
  });

  it('defaults to the masculine label when no gender getter is supplied', () => {
    const items: Item[] = [{ id: 'a', value: 15, gender: 'F' }];
    const ranks = rankBy(
      items,
      (i) => i.id,
      (i) => i.value,
    );
    expect(ranks.get('a')).toBe('1er');
  });
});

describe('computeGroupAverage', () => {
  it('matches the "Moyenne Matières Littéraires" worked example', () => {
    const subjects = [
      {
        category: SubjectCategory.LITTERAIRE,
        moyenneDefinitive: 42.5,
        coefficient: 3,
      },
      {
        category: SubjectCategory.LITTERAIRE,
        moyenneDefinitive: 20,
        coefficient: 2,
      },
      {
        category: SubjectCategory.LITTERAIRE,
        moyenneDefinitive: 23,
        coefficient: 2,
      },
      {
        category: SubjectCategory.LITTERAIRE,
        moyenneDefinitive: 35.34,
        coefficient: 2,
      },
      {
        category: SubjectCategory.SCIENTIFIQUE,
        moyenneDefinitive: 42.5,
        coefficient: 3,
      },
    ];
    expect(
      computeGroupAverage(subjects, SubjectCategory.LITTERAIRE),
    ).toBeCloseTo(13.43, 2);
  });

  it('excludes ungraded subjects and returns null if the whole group is ungraded', () => {
    const subjects = [
      {
        category: SubjectCategory.AUTRE,
        moyenneDefinitive: null,
        coefficient: 1,
      },
    ];
    expect(computeGroupAverage(subjects, SubjectCategory.AUTRE)).toBeNull();
  });
});

describe('computeStudentPeriodTotals', () => {
  it('matches the "Total points / Total coef / MGP" worked example', () => {
    const subjects = [
      { moyenneDefinitive: 42.5, coefficient: 3 },
      { moyenneDefinitive: 20, coefficient: 2 },
      { moyenneDefinitive: 23, coefficient: 2 },
      { moyenneDefinitive: 35.34, coefficient: 2 },
      { moyenneDefinitive: 42.5, coefficient: 3 },
      { moyenneDefinitive: 26, coefficient: 3 },
      { moyenneDefinitive: 20, coefficient: 2 },
      { moyenneDefinitive: 12.5, coefficient: 1 },
      { moyenneDefinitive: 12.5, coefficient: 1 },
      { moyenneDefinitive: 11.17, coefficient: 1 },
    ];
    const totals = computeStudentPeriodTotals(subjects);
    expect(totals.totalPoints).toBeCloseTo(245.51, 2);
    expect(totals.totalCoef).toBe(20);
    expect(totals.moyenneGenerale).toBeCloseTo(12.28, 2);
  });

  it('throws if every subject is ungraded', () => {
    expect(() =>
      computeStudentPeriodTotals([{ moyenneDefinitive: null, coefficient: 3 }]),
    ).toThrow();
  });
});
