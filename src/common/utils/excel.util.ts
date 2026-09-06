import * as XLSX from 'xlsx';

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .trim();
}

export function readExcelRows(
  fileBuffer: Buffer,
): Array<Record<string, unknown>> {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
    blankrows: false,
  });

  return rawRows.map((row) => {
    const normalized: Record<string, unknown> = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeKey(String(key))] = value;
    });
    return normalized;
  });
}

export function pickRowValue(
  row: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    const value = row[normalizedKey];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

// Excel date cells come back from readExcelRows() as locale-formatted
// strings (e.g. "05/08/2026"), not real Date objects - handing that
// straight to `new Date(...)` is ambiguous (JS assumes mm/dd/yyyy for
// slash-separated strings) and silently misreads any day <= 12 the way a
// French/dd-mm-yyyy-entered spreadsheet means it. This explicitly parses
// the dd/mm/yyyy (or dd-mm-yyyy) convention used throughout this app's own
// date formatting before falling back to native parsing for anything else
// (e.g. an already-ISO yyyy-mm-dd string). Returns an ISO yyyy-mm-dd
// string, or null if the value can't be parsed as a date at all.
export function parseExcelDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (dmyMatch) {
    const [, day, month, yearRaw] = dmyMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const dayNum = Number(day);
    const monthNum = Number(month);
    if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) {
      return null;
    }
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime())
    ? null
    : fallback.toISOString().slice(0, 10);
}

export function buildExcelBuffer(
  sheetName: string,
  rows: Array<Record<string, unknown>>,
  title?: string,
) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  if (title && rows.length === 0) {
    XLSX.utils.sheet_add_aoa(worksheet, [[title]], { origin: 'A1' });
  }

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}
