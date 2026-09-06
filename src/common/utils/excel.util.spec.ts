import { parseExcelDate } from './excel.util';

describe('parseExcelDate', () => {
  it('parses dd/mm/yyyy as day-month-year, not the JS default mm/dd/yyyy', () => {
    // 5 August, not 8 May - this is exactly the ambiguity that silently
    // corrupted imported birth dates before this parser existed.
    expect(parseExcelDate('05/08/2026')).toBe('2026-08-05');
  });

  it('parses dd-mm-yyyy with dash separators', () => {
    expect(parseExcelDate('05-08-2026')).toBe('2026-08-05');
  });

  it('parses an unambiguous day (>12) correctly regardless of format confusion', () => {
    expect(parseExcelDate('16/08/2026')).toBe('2026-08-16');
  });

  it('expands a 2-digit year to 20xx', () => {
    expect(parseExcelDate('05/08/26')).toBe('2026-08-05');
  });

  it('passes through an already-ISO yyyy-mm-dd string unchanged', () => {
    expect(parseExcelDate('2026-08-05')).toBe('2026-08-05');
  });

  it('rejects an impossible day/month combination', () => {
    expect(parseExcelDate('32/13/2026')).toBeNull();
  });

  it('rejects an empty or blank value', () => {
    expect(parseExcelDate('')).toBeNull();
    expect(parseExcelDate('   ')).toBeNull();
  });

  it('rejects unparseable garbage instead of throwing', () => {
    expect(parseExcelDate('not a date')).toBeNull();
  });
});
