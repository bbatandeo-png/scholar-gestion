import * as XLSX from 'xlsx';
import {
  diceCoefficient,
  normalizeLabel,
  parseBulletinWorkbook,
  splitNameForMatching,
} from './bulletins-import.util';

function buildWorkbookBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Feuille 1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const IDENTITY_HEADERS = [' ', 'Nom et Prénoms', 'Matricule', 'Sexe', 'N/R'];
const SUBJECT_SUB_HEADERS = ['i1', 'i2', 'Devoir', 'Compo', 'Coef', 'Prof'];
const TRAILING_HEADERS = [
  'Classe',
  'Titulaire de la classe',
  "Nom du Chef d'établissement",
  'Année scolaire',
  'Date du conseil',
  'Moyenne Générale de la période',
  'Rang',
  'Appréciation',
];

function buildHeaderRow(subjectNames: string[]): unknown[] {
  const row: unknown[] = [...IDENTITY_HEADERS];
  for (const name of subjectNames) {
    row.push(name, ...SUBJECT_SUB_HEADERS);
  }
  row.push(...TRAILING_HEADERS);
  return row;
}

describe('normalizeLabel', () => {
  it('strips accents, punctuation and collapses whitespace, uppercases', () => {
    expect(normalizeLabel('Histo-Géo')).toBe('HISTO GEO');
    expect(normalizeLabel('  Éducation   Civique ')).toBe('EDUCATION CIVIQUE');
  });

  it('never fixes typos - preserves them after normalization', () => {
    expect(normalizeLabel('IINFORMATIQUE')).toBe('IINFORMATIQUE');
  });
});

describe('splitNameForMatching', () => {
  it('returns both plausible orderings for a two-part name', () => {
    expect(splitNameForMatching('ADOKPE Gildas')).toEqual([
      'ADOKPE GILDAS',
      'GILDAS ADOKPE',
    ]);
  });

  it('handles multi-part names', () => {
    expect(splitNameForMatching('AFANOU Kepler Nunyan')).toEqual([
      'AFANOU KEPLER NUNYAN',
      'NUNYAN KEPLER AFANOU',
    ]);
  });
});

describe('diceCoefficient', () => {
  it('scores identical strings as 1', () => {
    expect(diceCoefficient('ADOKPE GILDAS', 'ADOKPE GILDAS')).toBe(1);
  });

  it('scores very different strings low', () => {
    expect(diceCoefficient('ADOKPE GILDAS', 'ZANDOH KOMLAN')).toBeLessThan(0.3);
  });

  it('scores a near-duplicate spelling reasonably high', () => {
    expect(diceCoefficient('ADOKPE GILDAS', 'ADOKPE GILDA')).toBeGreaterThan(
      0.8,
    );
  });
});

describe('parseBulletinWorkbook', () => {
  it('dynamically detects subject block count (not hardcoded to 10)', () => {
    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français', 'Maths']),
      [
        1,
        'DUPONT Jean',
        '',
        'M',
        '',
        'Français',
        null,
        12,
        14,
        15,
        2,
        'PROF1',
        'Maths',
        null,
        10,
        11,
        12,
        3,
        'PROF2',
        '6eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    const parsed = parseBulletinWorkbook(buffer);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].notes).toHaveLength(2);
    expect(parsed.rows[0].notes.map((n) => n.subjectNameRaw)).toEqual([
      'Français',
      'Maths',
    ]);
  });

  it('treats a blank note cell as null, not 0, and parses a literal 0 as 0', () => {
    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'DUPONT Jean',
        '',
        'M',
        '',
        'Français',
        '',
        12,
        0,
        15,
        2,
        'PROF1',
        '6eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    const parsed = parseBulletinWorkbook(buffer);
    const note = parsed.rows[0].notes[0];
    expect(note.i1).toBeNull();
    expect(note.i2).toBe(12);
    expect(note.devoir).toBe(0);
    expect(note.compo).toBe(15);
  });

  it('preserves a subject-name typo exactly (no fuzzy correction) while still parsing its notes', () => {
    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['IINFORMATIQUE']),
      [
        1,
        'DUPONT Jean',
        '',
        'M',
        '',
        'IINFORMATIQUE',
        null,
        14,
        15,
        16,
        1,
        'PROF1',
        '6eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    const parsed = parseBulletinWorkbook(buffer);
    expect(parsed.rows[0].notes[0].subjectNameRaw).toBe('IINFORMATIQUE');
  });

  it('extracts file-level metadata (classe, titulaire, annee scolaire, date du conseil) from the first data row', () => {
    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'DUPONT Jean',
        '',
        'M',
        '',
        'Français',
        null,
        12,
        14,
        15,
        2,
        'PROF1',
        '6eme',
        'TITULAIRE X',
        'CHEF Y',
        '2025-2026',
        new Date(2026, 1, 9),
        null,
        null,
        null,
      ],
    ]);

    const parsed = parseBulletinWorkbook(buffer);
    expect(parsed.meta.classe).toBe('6eme');
    expect(parsed.meta.titulaire).toBe('TITULAIRE X');
    expect(parsed.meta.chefEtablissement).toBe('CHEF Y');
    expect(parsed.meta.anneeScolaire).toBe('2025-2026');
    expect(parsed.meta.dateDuConseil).toBeInstanceOf(Date);
    expect(parsed.meta.dateDuConseil?.getFullYear()).toBe(2026);
  });

  it('throws a clear error when the identity columns do not match the expected template', () => {
    const buffer = buildWorkbookBuffer([
      ['Wrong', 'Header', 'Shape', 'Here', 'Nope'],
      [1, 'DUPONT Jean', '', 'M', ''],
    ]);

    expect(() => parseBulletinWorkbook(buffer)).toThrow(
      'Modele de fichier non reconnu',
    );
  });

  it('skips rows with a blank name (e.g. trailing blank rows)', () => {
    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'DUPONT Jean',
        '',
        'M',
        '',
        'Français',
        null,
        12,
        14,
        15,
        2,
        'PROF1',
        '6eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        2,
        '',
        '',
        '',
        '',
        'Français',
        null,
        null,
        null,
        null,
        2,
        'PROF1',
        '6eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    const parsed = parseBulletinWorkbook(buffer);
    expect(parsed.rows).toHaveLength(1);
  });
});
