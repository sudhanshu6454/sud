/**
 * Amazon.in Associates earnings report: the layout, in ONE table.
 *
 * ###########################################################################
 * # LAYOUT TO CONFIRM WITH A REAL EXPORT.                                   #
 * #                                                                         #
 * # Amazon's pages document the report types and the on-screen columns    #
 * # (Earnings: "Item Name, Seller, Price, Referral-Commission Rate, Items   #
 * # Dispatched, Revenue, Earnings"; tracking IDs are "included for each    #
 * # transaction"; downloads are tab-separated, or XML), but NOT the        #
 * # download's column layout, its date or decimal format, or any order /  #
 * # line id (policy brief §6). This table is built against the best-       #
 * # documented Associates Central layout (the Fee-Earnings download: a     #
 * # title line, then Category, Name, ASIN, Seller, Tracking ID, Date       #
 * # Shipped, Price, Items Shipped, Returns, Revenue, Ad Fees, Device Type  #
 * # Group). When the owner's first real download arrives, match its header #
 * # against EARNINGS_COLUMNS below (add aliases; nothing else changes).    #
 * ###########################################################################
 *
 * Parsing is header-driven: the header is the first of the first
 * HEADER_SEARCH_ROWS non-blank rows that names every required column (title
 * lines above it are skipped), in any order; unknown columns are ignored.
 * Tab-separated first (Amazon's documented download), comma-separated as
 * the fallback. A UTF-8 BOM and quoted fields are handled. A file whose
 * header cannot be found is refused with the list of what was expected and
 * what was seen — never read by position.
 */
import { AMAZON_IN_CURRENCY, normaliseAsin, parseDecimalMinorUnits, validateTrackingId } from '@paparazzi/shared';
import { parseCsv } from '../delimited.js';

export type EarningsField =
  | 'tracking_id'
  | 'asin'
  | 'date'
  | 'items_shipped'
  | 'revenue'
  | 'ad_fees'
  | 'returns'
  | 'price'
  | 'seller'
  | 'item_name'
  | 'category'
  | 'device_type_group'
  | 'link_type'
  | 'subtag'
  | 'rate';

export interface ColumnSpec {
  required: boolean;
  /** Money columns carry a currency annotation in the header, e.g. "Price(Rs.)". */
  money: boolean;
  /** Header texts accepted for this field, compared after normaliseHeader(). */
  aliases: readonly string[];
}

/**
 * THE column table (see the banner above). Header texts are compared after
 * normaliseHeader(): lower case, a trailing "(…)" annotation removed, runs
 * of spaces / hyphens / underscores collapsed to one space.
 */
export const EARNINGS_COLUMNS: Readonly<Record<EarningsField, ColumnSpec>> = {
  tracking_id: { required: true, money: false, aliases: ['tracking id', 'trackingid', 'tag', 'associate tag'] },
  asin: { required: true, money: false, aliases: ['asin', 'asin isbn'] },
  date: {
    required: true,
    money: false,
    aliases: ['date shipped', 'date dispatched', 'shipped date', 'dispatched date', 'shipment date', 'dispatch date'],
  },
  items_shipped: {
    required: true,
    money: false,
    aliases: ['items shipped', 'items dispatched', 'shipped items', 'dispatched items', 'qty shipped'],
  },
  revenue: { required: true, money: true, aliases: ['revenue', 'shipped revenue', 'total revenue'] },
  ad_fees: {
    required: true,
    money: true,
    aliases: ['ad fees', 'advertising fees', 'earnings', 'referral fees', 'fees', 'referral fee'],
  },
  returns: { required: false, money: false, aliases: ['returns', 'items returned', 'returned items', 'total items returned'] },
  price: { required: false, money: true, aliases: ['price', 'item price', 'unit price'] },
  seller: { required: false, money: false, aliases: ['seller', 'sold by'] },
  item_name: { required: false, money: false, aliases: ['name', 'item name', 'product name', 'title', 'product title'] },
  category: { required: false, money: false, aliases: ['category', 'product category', 'product group'] },
  device_type_group: { required: false, money: false, aliases: ['device type group', 'device type', 'device'] },
  link_type: { required: false, money: false, aliases: ['direct', 'link type', 'direct indirect', 'direct/indirect'] },
  subtag: { required: false, money: false, aliases: ['subtag', 'sub tag', 'ascsubtag'] },
  rate: {
    required: false,
    money: false,
    aliases: ['referral commission rate', 'referral fee rate', 'rate', 'fee rate', 'commission rate'],
  },
};

/** How many non-blank rows are searched for the header (title lines above it are skipped). */
export const HEADER_SEARCH_ROWS = 10;

/** Currency annotations recognised in money headers, e.g. "Revenue(Rs.)". */
const CURRENCY_ANNOTATIONS: Readonly<Record<string, string>> = {
  'rs': 'INR',
  'rs.': 'INR',
  '₹': 'INR',
  'inr': 'INR',
  'rupees': 'INR',
  '$': 'USD',
  'usd': 'USD',
  '£': 'GBP',
  'gbp': 'GBP',
  '€': 'EUR',
  'eur': 'EUR',
};

export interface NormalisedHeader {
  name: string;
  /** Text inside a trailing "(…)", lower-cased, or null. */
  annotation: string | null;
}

export function normaliseHeader(raw: string): NormalisedHeader {
  let v = raw.replace(/^﻿/, '').trim().toLowerCase();
  let annotation: string | null = null;
  const m = /\s*\(([^)]*)\)\s*$/.exec(v);
  if (m) {
    annotation = (m[1] ?? '').trim();
    v = v.slice(0, m.index);
  }
  return { name: v.replace(/[\s_-]+/g, ' ').trim(), annotation };
}

const ALIAS_INDEX: ReadonlyMap<string, EarningsField> = (() => {
  const m = new Map<string, EarningsField>();
  for (const [field, spec] of Object.entries(EARNINGS_COLUMNS) as Array<[EarningsField, ColumnSpec]>) {
    for (const a of spec.aliases) m.set(normaliseHeader(a).name, field);
  }
  return m;
})();

export interface RowError {
  row: number;
  reason: string;
}

export interface EarningsRow {
  /** 1-based line of the file (title lines and the header count). */
  row: number;
  kind: 'shipped' | 'return' | 'zero';
  trackingId: string;
  asin: string;
  /** YYYY-MM-DD, the report's own date (IST day). */
  date: string;
  seller: string;
  deviceTypeGroup: string;
  linkType: string;
  subtag: string | null;
  itemName: string;
  /** Unit price in paise, when the report has a price column. */
  priceMinor: number | null;
  itemsShipped: number;
  returns: number;
  /** Signed paise (negative on a return row). */
  revenueMinor: number;
  /** Signed paise (negative on a return row). */
  adFeesMinor: number;
}

export interface ParsedEarningsReport {
  delimiter: 'tab' | 'comma';
  /** 1-based line of the header. */
  headerRow: number;
  /** canonical field → the header text it was read from. */
  columns: Partial<Record<EarningsField, string>>;
  currency: string;
  rows: EarningsRow[];
}

export type EarningsParse =
  | { ok: true; report: ParsedEarningsReport }
  | { ok: false; message: string; errors: RowError[] };

/**
 * Tab-separated rows: a field is taken verbatim (Amazon's download is plain
 * TSV), except that a field wrapped in double quotes is unwrapped and `""`
 * unescaped. A quote inside a field is ordinary text (an item name like
 * `12" pan`), unlike the RFC-4180 CSV reader.
 */
export function parseTsv(text: string): string[][] {
  const s = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = s.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) =>
    line.split('\t').map((f) => (f.length >= 2 && f.startsWith('"') && f.endsWith('"') ? f.slice(1, -1).replace(/""/g, '"') : f)),
  );
}

const isBlank = (cells: string[]) => cells.every((c) => c.trim() === '');

interface HeaderMatch {
  index: number;
  cols: Map<EarningsField, number>;
  columns: Partial<Record<EarningsField, string>>;
  annotations: Map<EarningsField, string | null>;
  duplicate: EarningsField | null;
}

function matchHeader(cells: string[]): HeaderMatch {
  const cols = new Map<EarningsField, number>();
  const columns: Partial<Record<EarningsField, string>> = {};
  const annotations = new Map<EarningsField, string | null>();
  let duplicate: EarningsField | null = null;
  cells.forEach((cell, i) => {
    const h = normaliseHeader(cell);
    const field = ALIAS_INDEX.get(h.name);
    if (!field) return;
    if (cols.has(field)) duplicate = duplicate ?? field;
    else {
      cols.set(field, i);
      columns[field] = cell.trim();
      annotations.set(field, h.annotation);
    }
  });
  return { index: -1, cols, columns, annotations, duplicate };
}

const REQUIRED: EarningsField[] = (Object.entries(EARNINGS_COLUMNS) as Array<[EarningsField, ColumnSpec]>)
  .filter(([, s]) => s.required)
  .map(([f]) => f);

function findHeader(records: string[][]): HeaderMatch | null {
  let seen = 0;
  for (let i = 0; i < records.length && seen < HEADER_SEARCH_ROWS; i += 1) {
    const cells = records[i] as string[];
    if (isBlank(cells)) continue;
    seen += 1;
    const m = matchHeader(cells);
    if (REQUIRED.every((f) => m.cols.has(f))) return { ...m, index: i };
  }
  return null;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The report date as YYYY-MM-DD. Only unambiguous forms are read: ISO
 * (2026-09-29, optionally followed by a time, which is dropped — its time
 * zone is undocumented) and month names (Sep 29, 2026 / 29 Sep 2026 /
 * 29-Sep-2026). A numeric day/month form such as 09/10/2026 is refused:
 * Amazon's pages do not say which is the day, and guessing it would move a
 * sale by months.
 */
export function parseReportDate(raw: string): string | null {
  const v = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(v);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(v);
  if (m) {
    const mon = MONTHS[(m[1] as string).toLowerCase()];
    return mon ? isoDate(Number(m[3]), mon, Number(m[2])) : null;
  }
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ ,-]+(\d{4})$/.exec(v);
  if (m) {
    const mon = MONTHS[(m[2] as string).toLowerCase()];
    return mon ? isoDate(Number(m[3]), mon, Number(m[1])) : null;
  }
  return null;
}

/** occurred_at of a report row: the start of its IST day. */
export function reportDateToOccurredAt(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

function count(raw: string): number | null {
  const v = raw.trim();
  if (v === '') return 0;
  return /^\d+$/.test(v) && Number(v) <= 1_000_000 ? Number(v) : null;
}

/**
 * Parse (and fully validate) an earnings report. All-or-nothing: any row
 * error refuses the whole file. Nothing here touches the database.
 */
export function parseEarningsReport(text: string, accountCurrency = AMAZON_IN_CURRENCY): EarningsParse {
  const head = text.replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) {
    return {
      ok: false,
      message:
        'This looks like the XML download. Only the tab-separated (or comma-separated) earnings download is read so far; ' +
        'download the report as TSV/CSV, or send a sample so the XML layout can be added',
      errors: [{ row: 0, reason: 'XML report layout not supported' }],
    };
  }

  let delimiter: 'tab' | 'comma' = 'tab';
  let records = parseTsv(text);
  let header = findHeader(records);
  if (!header) {
    try {
      const commaRecords = parseCsv(text);
      const commaHeader = findHeader(commaRecords);
      if (commaHeader) {
        delimiter = 'comma';
        records = commaRecords;
        header = commaHeader;
      }
    } catch {
      // An unparseable CSV is simply not the comma layout; the error below says what was expected.
    }
  }
  if (!header) {
    const firstRows = records
      .filter((r) => !isBlank(r))
      .slice(0, 3)
      .map((r) => r.map((c) => c.trim()).filter((c) => c !== '').join(' | '));
    return {
      ok: false,
      message:
        'Unknown report layout: no header row naming the required columns was found in the first ' +
        `${HEADER_SEARCH_ROWS} non-blank rows. Required: ${REQUIRED.map((f) => EARNINGS_COLUMNS[f].aliases[0]).join(', ')} ` +
        '(aliases in packages/api/src/amazon/report-format.ts, EARNINGS_COLUMNS). Nothing was imported',
      errors: [{ row: 0, reason: `first rows seen: ${firstRows.map((r) => `[${r.slice(0, 200)}]`).join(' ') || '(none)'}` }],
    };
  }
  if (header.duplicate) {
    return {
      ok: false,
      message: `Unknown report layout: two columns map to '${header.duplicate}'. Nothing was imported`,
      errors: [{ row: header.index + 1, reason: `duplicate column for '${header.duplicate}'` }],
    };
  }

  // Money headers may say their currency; it must be the account's.
  let currency = accountCurrency;
  for (const [field, annotation] of header.annotations) {
    if (!EARNINGS_COLUMNS[field].money || annotation === null || annotation === '') continue;
    const cur = CURRENCY_ANNOTATIONS[annotation];
    if (!cur) {
      return {
        ok: false,
        message: `Unknown currency annotation '(${annotation})' on the ${header.columns[field]} column. Nothing was imported`,
        errors: [{ row: header.index + 1, reason: `unrecognised currency '(${annotation})'` }],
      };
    }
    if (cur !== accountCurrency) {
      return {
        ok: false,
        message: `The report is in ${cur} (${header.columns[field]}); this account reports in ${accountCurrency}. Nothing was imported`,
        errors: [{ row: header.index + 1, reason: `currency ${cur} is not ${accountCurrency}` }],
      };
    }
    currency = cur;
  }

  const cell = (cells: string[], f: EarningsField): string => {
    const i = header.cols.get(f);
    return i === undefined ? '' : (cells[i] ?? '').trim();
  };

  const rows: EarningsRow[] = [];
  const errors: RowError[] = [];
  for (let i = header.index + 1; i < records.length; i += 1) {
    const cells = records[i] as string[];
    if (isBlank(cells)) continue;
    const rowNum = i + 1;
    const reasons: string[] = [];

    const tracking = validateTrackingId(cell(cells, 'tracking_id'));
    if (!tracking.ok) reasons.push(`tracking ID: ${tracking.reason}`);
    const asin = normaliseAsin(cell(cells, 'asin'));
    if (!asin) reasons.push(`ASIN '${cell(cells, 'asin')}' is not a 10-character ASIN`);
    const date = parseReportDate(cell(cells, 'date'));
    if (!date) {
      reasons.push(
        `date '${cell(cells, 'date')}' is not an unambiguous date (YYYY-MM-DD or a month name; layout to confirm with a real export)`,
      );
    }
    const itemsShipped = count(cell(cells, 'items_shipped'));
    if (itemsShipped === null) reasons.push(`items shipped '${cell(cells, 'items_shipped')}' is not a whole number`);
    const returns = header.cols.has('returns') ? count(cell(cells, 'returns')) : 0;
    if (returns === null) reasons.push(`returns '${cell(cells, 'returns')}' is not a whole number`);

    const money = (f: EarningsField, allowBlank: boolean): number | null => {
      const raw = cell(cells, f);
      if (raw === '' && allowBlank) return null;
      const r = parseDecimalMinorUnits(raw, { fractionDigits: 2, allowNegative: true });
      if (!r.ok) {
        reasons.push(`${header.columns[f] ?? f}: ${r.reason}`);
        return null;
      }
      return r.minor;
    };
    const revenueMinor = money('revenue', false);
    const adFeesMinor = money('ad_fees', false);
    const priceMinor = header.cols.has('price') ? money('price', true) : null;

    let kind: EarningsRow['kind'] | null = null;
    if (reasons.length === 0) {
      const shipped = itemsShipped as number;
      const ret = returns as number;
      const rev = revenueMinor as number;
      const fee = adFeesMinor as number;
      if (shipped === 0 && ret === 0 && rev === 0 && fee === 0) kind = 'zero';
      else if (shipped > 0 && ret === 0 && rev >= 0 && fee >= 0) kind = 'shipped';
      else if (shipped === 0 && rev <= 0 && fee <= 0 && (ret > 0 || rev < 0 || fee < 0)) kind = 'return';
      else {
        reasons.push(
          `row mixes shipped and returned values (items shipped ${shipped}, returns ${ret}, revenue ${rev}, fees ${fee} paise); layout to confirm with a real export`,
        );
      }
      if (priceMinor !== null && priceMinor < 0) reasons.push('price is negative');
    }

    if (reasons.length > 0 || !kind) {
      errors.push({ row: rowNum, reason: reasons.join('; ') });
      continue;
    }
    rows.push({
      row: rowNum,
      kind,
      trackingId: (tracking as { value: string }).value,
      asin: asin as string,
      date: date as string,
      seller: cell(cells, 'seller'),
      deviceTypeGroup: cell(cells, 'device_type_group'),
      linkType: cell(cells, 'link_type'),
      subtag: cell(cells, 'subtag') || null,
      itemName: cell(cells, 'item_name'),
      priceMinor,
      itemsShipped: itemsShipped as number,
      returns: returns as number,
      revenueMinor: revenueMinor as number,
      adFeesMinor: adFeesMinor as number,
    });
  }

  if (errors.length > 0) {
    return { ok: false, message: `${errors.length} row(s) failed validation; nothing was imported`, errors };
  }
  if (rows.length === 0) {
    return { ok: false, message: 'The report has a header but no data rows; nothing was imported', errors: [] };
  }
  return {
    ok: true,
    report: { delimiter, headerRow: header.index + 1, columns: header.columns, currency, rows },
  };
}

/**
 * The row's identity, from the report's own fields: every column that tells
 * two aggregate rows apart (tracking ID, ASIN, date, seller, device type,
 * link type, unit price, sub-tag) and its kind. The same row in a later
 * download gives the same identity; any change to those fields is a
 * different row.
 */
export function earningsRowIdentity(r: EarningsRow): string {
  return JSON.stringify([
    r.kind === 'return' ? 'return' : 'shipped',
    r.trackingId,
    r.asin,
    r.date,
    r.seller,
    r.deviceTypeGroup,
    r.linkType,
    r.priceMinor,
    r.subtag,
  ]);
}
