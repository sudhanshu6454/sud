/**
 * Delimited-text parsing shared by the file-based importers: the CSV
 * settlement connector (routes/csv-uploads.ts) and the Amazon.in Associates
 * earnings-report import (amazon/report-format.ts, tab- or comma-separated).
 */

/**
 * Minimal RFC-4180 CSV parser (no dependencies):
 * - fields separated by `delimiter` (default `,`; the Amazon report import
 *   passes a tab); a field wrapped in `"` may contain the delimiter,
 *   newlines, and `""` (escaped quote);
 * - LF and CRLF both terminate records;
 * - a leading UTF-8 BOM is stripped.
 *
 * Throws on an unterminated quoted field.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const s = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (inQuotes) throw new Error('unterminated quoted field');
  // Trailing content after the last newline (a file not ending in \n still
  // holds a record); a file that ends WITH \n leaves nothing behind.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
