import * as XLSX from 'xlsx';

export type ParsedSubjectBlock = {
  columnIndex: number;
  nameRaw: string;
};

export type ParsedNoteCell = {
  subjectNameRaw: string;
  i1: number | null;
  i2: number | null;
  devoir: number | null;
  compo: number | null;
  coef: number | null;
  profRaw: string;
};

export type ParsedIdentityRow = {
  nameRaw: string;
  matriculeRaw: string;
  sexeRaw: string;
  notes: ParsedNoteCell[];
};

export type ParsedBulletinMeta = {
  classe: string;
  titulaire: string;
  chefEtablissement: string;
  anneeScolaire: string;
  dateDuConseil: Date | null;
};

export type ParsedBulletinFile = {
  meta: ParsedBulletinMeta;
  rows: ParsedIdentityRow[];
};

const NOTE_BLOCK_LABELS = ['i1', 'i2', 'devoir', 'compo', 'coef', 'prof'];
const IDENTITY_HEADER_ALIASES = [
  ['nom_et_prenoms', 'nom', 'nomprenoms'],
  ['matricule'],
  ['sexe'],
  ['n_r', 'nr'],
];

/** Safely stringifies a parsed spreadsheet cell (string/number/boolean/Date/null/undefined only - never an arbitrary object). */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return '';
}

/**
 * Normalizes a cell value (subject name, student name, header text) for
 * comparison: strips accents/punctuation, collapses whitespace, uppercases.
 * Never fixes typos (e.g. "IINFORMATIQUE" stays "IINFORMATIQUE") - this is
 * intentional, see bulletins module plan: exact-match-or-propose, never
 * fuzzy-guess a subject/header identity.
 */
export function normalizeLabel(value: unknown): string {
  return cellToString(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function toNullableNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const num =
    typeof value === 'number'
      ? value
      : Number(cellToString(value).replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function toTrimmedString(value: unknown): string {
  return cellToString(value).trim();
}

type ParsedDateCode = { y: number; m: number; d: number };

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number') {
    const parsed = (
      XLSX.SSF as { parse_date_code: (v: number) => ParsedDateCode | null }
    ).parse_date_code(value);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
  }
  return null;
}

function matchesAnyAlias(headerCell: unknown, aliases: string[]): boolean {
  const normalized = normalizeLabel(headerCell)
    .replace(/\s+/g, '_')
    .toLowerCase();
  return aliases.some((alias) => normalized === alias);
}

/**
 * Detects the dynamic list of subject blocks starting at column 5, each a
 * subject-name cell followed by 6 columns matching i1/i2/Devoir/Compo/Coef/Prof
 * (normalized). Stops at the first column that doesn't fit that shape -
 * that's where the trailing metadata block (Classe, Titulaire, ...) begins.
 * Tolerates any number of subjects (not hardcoded to 10).
 */
function detectSubjectBlocks(headerRow: unknown[]): ParsedSubjectBlock[] {
  const blocks: ParsedSubjectBlock[] = [];
  let col = 5;

  while (col + 6 < headerRow.length) {
    const nameRaw = toTrimmedString(headerRow[col]);
    if (!nameRaw) {
      break;
    }
    const subLabels = headerRow
      .slice(col + 1, col + 7)
      .map((cell) => normalizeLabel(cell).toLowerCase());
    const matches = subLabels.every(
      (label, index) => label === NOTE_BLOCK_LABELS[index],
    );
    if (!matches) {
      break;
    }
    blocks.push({ columnIndex: col, nameRaw });
    col += 7;
  }

  return blocks;
}

/**
 * Validates the 5 fixed identity columns (ordinal/Nom et Prénoms/Matricule/
 * Sexe/N-R) are present in the expected positions. Throws with a clear
 * message if the template isn't recognized, rather than silently misparsing.
 */
function assertIdentityColumns(headerRow: unknown[]): void {
  for (let i = 0; i < IDENTITY_HEADER_ALIASES.length; i += 1) {
    const cell = headerRow[i + 1];
    if (!matchesAnyAlias(cell, IDENTITY_HEADER_ALIASES[i])) {
      throw new Error(
        `Modele de fichier non reconnu : colonne ${i + 2} attendue parmi ${IDENTITY_HEADER_ALIASES[i].join(', ')}, trouve "${toTrimmedString(cell)}"`,
      );
    }
  }
}

function extractMeta(
  firstDataRow: unknown[],
  trailingStartColumn: number,
): ParsedBulletinMeta {
  const c = trailingStartColumn;
  return {
    classe: toTrimmedString(firstDataRow[c]),
    titulaire: toTrimmedString(firstDataRow[c + 1]),
    chefEtablissement: toTrimmedString(firstDataRow[c + 2]),
    anneeScolaire: toTrimmedString(firstDataRow[c + 3]),
    dateDuConseil: toDateOrNull(firstDataRow[c + 4]),
  };
}

/**
 * Parses the whole sheet positionally (not via readExcelRows/pickRowValue -
 * see bulletins module plan for why: the repeated i1/i2/Devoir/Compo/Coef/Prof
 * headers, once per subject, collide in readExcelRows's key-based object
 * mode before its own normalization ever runs).
 */
export function parseBulletinWorkbook(buffer: Buffer): ParsedBulletinFile {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Le fichier Excel ne contient aucune feuille');
  }

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });

  const headerRow = grid[0];
  if (!headerRow) {
    throw new Error('Le fichier Excel est vide');
  }

  assertIdentityColumns(headerRow);
  const subjectBlocks = detectSubjectBlocks(headerRow);
  if (subjectBlocks.length === 0) {
    throw new Error('Aucune matiere detectee dans le fichier');
  }
  const trailingStartColumn =
    subjectBlocks[subjectBlocks.length - 1].columnIndex + 7;

  const dataRows = grid
    .slice(1)
    .filter((row) => toTrimmedString(row[1]) !== '');

  const rows: ParsedIdentityRow[] = dataRows.map((row) => ({
    nameRaw: toTrimmedString(row[1]),
    matriculeRaw: toTrimmedString(row[2]),
    sexeRaw: toTrimmedString(row[3]),
    notes: subjectBlocks.map((block) => ({
      subjectNameRaw: block.nameRaw,
      i1: toNullableNumber(row[block.columnIndex + 1]),
      i2: toNullableNumber(row[block.columnIndex + 2]),
      devoir: toNullableNumber(row[block.columnIndex + 3]),
      compo: toNullableNumber(row[block.columnIndex + 4]),
      coef: toNullableNumber(row[block.columnIndex + 5]),
      profRaw: toTrimmedString(row[block.columnIndex + 6]),
    })),
  }));

  const meta =
    dataRows.length > 0
      ? extractMeta(dataRows[0], trailingStartColumn)
      : {
          classe: '',
          titulaire: '',
          chefEtablissement: '',
          anneeScolaire: '',
          dateDuConseil: null,
        };

  return { meta, rows };
}

/** Splits "Nom Prenoms" into both plausible orderings for name matching, since the source column doesn't tell us the split point. */
export function splitNameForMatching(nameRaw: string): string[] {
  const parts = normalizeLabel(nameRaw).split(' ').filter(Boolean);
  if (parts.length < 2) {
    return [normalizeLabel(nameRaw)];
  }
  const asIs = parts.join(' ');
  const reversed = [...parts].reverse().join(' ');
  return [asIs, reversed];
}

function bigrams(value: string): string[] {
  const clean = value.replace(/\s+/g, '');
  const pairs: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) {
    pairs.push(clean.slice(i, i + 2));
  }
  return pairs;
}

/**
 * Sorensen-Dice coefficient (0..1) over character bigrams - a lightweight,
 * dependency-free "how similar are these two strings" measure, used only to
 * SUGGEST a near-duplicate name match for manual confirmation, never to
 * auto-apply one (see bulletins module plan: never silent fuzzy matching).
 */
export function diceCoefficient(a: string, b: string): number {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.length === 0 || bigramsB.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const bg of bigramsA) {
    counts.set(bg, (counts.get(bg) ?? 0) + 1);
  }
  let intersection = 0;
  for (const bg of bigramsB) {
    const remaining = counts.get(bg) ?? 0;
    if (remaining > 0) {
      intersection += 1;
      counts.set(bg, remaining - 1);
    }
  }
  return (2 * intersection) / (bigramsA.length + bigramsB.length);
}
