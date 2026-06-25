import * as XLSX from 'xlsx';

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .trim();
}

export function readExcelRows(fileBuffer: Buffer): Array<Record<string, unknown>> {
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