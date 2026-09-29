/*
 * CSV for every "Export CSV" button (creator reports 3d, creator payouts 2c,
 * brand conversions): RFC 4180 fields, CRLF rows ending in CRLF; a field with
 * a comma, quote, CR or LF (or leading / trailing space) is quoted with its
 * quotes doubled; numbers are written unformatted so a spreadsheet reads
 * them as numbers; text a spreadsheet would run as a formula (=, +, -, @,
 * tab or CR first) gets a leading apostrophe, while a plain number such as
 * "-500.00" is left alone; money is rupees with two decimals computed from
 * integer paise (no floats). Pure — the page wraps the text in a Blob
 * (lib/download.ts adds the UTF-8 BOM). Relative imports only (tested).
 */

export type CsvCell = string | number | null | undefined;

/** First row of every demo export: the file holds TEST data. */
export const DEMO_CSV_LABEL = 'TEST demo data, not real figures';

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** One CSV field. Numbers are written as they are; text is guarded and quoted when needed. */
export function csvField(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  let text = cell;
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: ReadonlyArray<CsvCell>): string {
  return cells.map(csvField).join(',');
}

/** Rows joined with CRLF, ending in CRLF (RFC 4180). */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return rows.map(csvRow).join('\r\n') + '\r\n';
}

/** The demo label row, a blank row, then the table. */
export function toDemoCsv(table: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return toCsv([[DEMO_CSV_LABEL], [], ...table]);
}

/** Integer paise → "140940.00" (no floats, no grouping, sign first). */
export function minorToRupees(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`minor units must be an integer, got ${minor}`);
  const abs = Math.abs(minor);
  return `${minor < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** numerator ÷ denominator as a percentage with two decimals ("1.31"); null when the denominator is not positive. */
export function ratePct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}
