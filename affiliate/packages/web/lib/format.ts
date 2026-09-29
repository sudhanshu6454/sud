import type { Stock } from './types';

/**
 * Convert a price in paise (INR minor units) to a display string.
 * Example: 249900 -> "₹2,499"
 */
export function formatINR(minor: number): string {
  const rupees = Math.round(minor / 100);
  return '₹' + rupees.toLocaleString('en-IN');
}

/** ISO 4217 minor-unit exponent (INR 2, JPY 0); 2 when Intl does not know the code. */
function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** A non-INR amount in minor units through Intl, with exactly the currency's decimals. */
function formatForeign(minor: number, currency: string, alwaysDecimals: boolean): string {
  const exponent = currencyExponent(currency);
  const hasFraction = exponent > 0 && Math.abs(minor) % 10 ** exponent !== 0;
  const digits = alwaysDecimals || hasFraction ? exponent : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** exponent);
  } catch {
    return `${currency} ${(minor / 10 ** exponent).toFixed(exponent)}`;
  }
}

/**
 * Display a live price or balance given in minor units with its explicit
 * currency, never rounded: whole units when there is no fraction
 * (₹2,499), otherwise the exact amount (₹1,499.50). INR keeps the
 * platform's rupee style (Indian grouping); anything else goes through Intl.
 */
export function formatMoney(minor: number, currency: string): string {
  if (!Number.isFinite(minor)) return '—';
  if (currency === 'INR') return formatINRExact(minor);
  return formatForeign(minor, currency, false);
}

/**
 * Finance-ops amounts: always the currency's decimals, never rounded, in
 * the row's own currency (₹1,234.50, ₹150.00, US$14.99).
 */
export function formatMoneyExact(minor: number, currency: string): string {
  if (!Number.isFinite(minor)) return '—';
  if (currency === 'INR') return formatINRFromMinor(minor, { paise: true });
  return formatForeign(minor, currency, true);
}

/**
 * Human-friendly relative time for an ISO freshness timestamp.
 * Example: timeAgo('2026-09-22T10:00:00.000Z') -> "2h ago"
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

/**
 * Freshness sentence for an offer's `fresh_until`. The API only returns
 * offers whose fresh_until is still in the future, so "valid until" is the
 * honest phrasing; a past value (demo data or clock skew) reads as expired.
 */
export function freshnessLabel(freshUntilIso: string, now: Date = new Date()): string {
  const until = new Date(freshUntilIso);
  if (Number.isNaN(until.getTime())) return 'Price freshness unknown — check current price at merchant';
  if (until.getTime() <= now.getTime()) {
    return `Price check expired ${timeAgo(freshUntilIso, now)} — check current price at merchant`;
  }
  const diffMin = Math.round((until.getTime() - now.getTime()) / 60000);
  const window =
    diffMin < 60 ? `${Math.max(1, diffMin)}m` : diffMin < 24 * 60 ? `${Math.round(diffMin / 60)}h` : `${Math.round(diffMin / (24 * 60))}d`;
  return `Price valid for ${window} — check current price at merchant`;
}

/** India Standard Time: UTC+05:30 all year (no daylight saving), so the offset is fixed. */
const IST_OFFSET_MS = 330 * 60_000;

/**
 * The time stamp Amazon asks for beside a product-API price (Operating
 * Agreement §11, whose example reads "Amazon.in Price: Rs.3500 (as of
 * 13/07/2013 14:11 IST - Details)"): "as of 29/09/2026 14:11 IST", always
 * with the date, in India Standard Time. null for a missing or invalid time.
 */
export function priceAsOfLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const d = new Date(t + IST_OFFSET_MS);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `as of ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} IST`;
}

export function stockLabel(stock: Stock): string {
  switch (stock) {
    case 'in_stock':
      return 'In stock';
    case 'low_stock':
      return 'Low stock';
    case 'out_of_stock':
      return 'Out of stock';
    default:
      return stock.replace(/_/g, ' ');
  }
}

/* ------------------------------------------------------------------------
 * Afflino display formats (design handover 1b–3f).
 *
 * Rules inferred from the mocks and reproduced exactly:
 * - Rupee amounts use Indian digit grouping (lakh / crore): ₹1,84,320,
 *   ₹25,00,000, ₹2,52,360.
 * - Counts (clicks, sign-ups, creators, installs) use western thousands
 *   grouping: 312,880 and 271,040 — never 3,12,880. Below 1,00,000 both
 *   groupings agree (84,210; 18,406), so the mocks only disambiguate there.
 * - Compact rupees: ≥ ₹1 crore → "₹4.8Cr", ≥ ₹1 lakh → "₹18.4L", one
 *   decimal, a trailing ".0" dropped ("₹25L"); below a lakh the full amount
 *   (₹74,160).
 * - Compact counts: K / M / B with one decimal, trailing ".0" dropped
 *   (420K, 1.2M, 9.8M).
 * - Compact figures TRUNCATE to one decimal, they do not round: the mock
 *   shows 312,880 clicks as "312.8K" (rounding would give 312.9K). So a
 *   compact figure never overstates reach or money.
 * - Paise are shown only where the design shows them (EPC "₹6.10",
 *   "₹3.00"): formatINRFromMinor(minor, { paise: true }).
 * - Percentages take the decimals the context shows: "1.31%" (CR),
 *   "1.9%" (sub-ID CR), "61%" (platform share), "+22%" (signed delta).
 * - Negative amounts put the sign before the symbol: "-₹500".
 * ---------------------------------------------------------------------- */

/** "184320" → "1,84,320" (last three digits, then pairs). */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** "312880" → "312,880". */
function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const DASH = '—';

/** Whole rupees with Indian grouping: 184320 → "₹1,84,320" (rounded to the rupee). */
export function formatINRWhole(rupees: number): string {
  if (!Number.isFinite(rupees)) return DASH;
  const r = Math.round(Math.abs(rupees));
  const sign = rupees < 0 && r !== 0 ? '-' : '';
  return `${sign}₹${groupIndian(String(r))}`;
}

/**
 * Minor units (paise) to rupees with Indian grouping. Default: rounded to
 * the rupee (18000 → "₹180"); { paise: true } keeps two decimals
 * (610 → "₹6.10", 300 → "₹3.00").
 */
export function formatINRFromMinor(minor: number, opts: { paise?: boolean } = {}): string {
  if (!Number.isFinite(minor)) return DASH;
  const abs = Math.round(Math.abs(minor));
  if (opts.paise) {
    const sign = minor < 0 && abs !== 0 ? '-' : '';
    const rupees = Math.floor(abs / 100);
    const paise = abs % 100;
    return `${sign}₹${groupIndian(String(rupees))}.${String(paise).padStart(2, '0')}`;
  }
  const rupees = Math.round(abs / 100);
  const sign = minor < 0 && rupees !== 0 ? '-' : '';
  return `${sign}₹${groupIndian(String(rupees))}`;
}

/**
 * A live rupee amount, never rounded: whole rupees when the paise are zero
 * (4290000 → "₹42,900"), otherwise two decimals (4290050 → "₹42,900.50").
 * Live balances carry arbitrary paise; the designed demo figures are whole
 * rupees, so they print exactly as drawn.
 */
export function formatINRExact(minor: number): string {
  if (!Number.isFinite(minor)) return DASH;
  return formatINRFromMinor(minor, { paise: Math.round(Math.abs(minor)) % 100 !== 0 });
}

/** Tenths → "18.4" / "25" (whole part grouped the Indian way). */
function tenthsLabel(tenths: number): string {
  const whole = Math.trunc(tenths / 10);
  const decimal = tenths % 10;
  return decimal === 0 ? groupIndian(String(whole)) : `${groupIndian(String(whole))}.${decimal}`;
}

/**
 * Compact rupees for KPIs: 48000000 → "₹4.8Cr", 1840000 → "₹18.4L",
 * 2500000 → "₹25L", 74160 → "₹74,160". Truncates to one decimal.
 */
export function formatINRCompact(rupees: number): string {
  if (!Number.isFinite(rupees)) return DASH;
  return formatINRCompactFromMinor(Math.round(rupees * 100));
}

/** formatINRCompact from minor units (paise): 184000000 → "₹18.4L". */
export function formatINRCompactFromMinor(minor: number): string {
  if (!Number.isFinite(minor)) return DASH;
  const abs = Math.round(Math.abs(minor));
  const CRORE = 1_000_000_000; // ₹1,00,00,000 in paise
  const LAKH = 10_000_000; // ₹1,00,000 in paise
  let body: string;
  if (abs >= CRORE) body = `${tenthsLabel(Math.trunc((abs * 10) / CRORE))}Cr`;
  else if (abs >= LAKH) body = `${tenthsLabel(Math.trunc((abs * 10) / LAKH))}L`;
  else return formatINRFromMinor(minor);
  return `${minor < 0 ? '-' : ''}₹${body}`;
}

/** Counts with western thousands grouping: 312880 → "312,880" (rounded to an integer). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  const r = Math.round(Math.abs(n));
  return `${n < 0 && r !== 0 ? '-' : ''}${groupWestern(String(r))}`;
}

/**
 * Compact counts: 312880 → "312.8K", 1200000 → "1.2M", 420000 → "420K",
 * 9800000 → "9.8M"; below 1,000 the plain count. Truncates to one decimal.
 */
export function formatCountCompact(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  const abs = Math.round(Math.abs(n));
  const sign = n < 0 && abs !== 0 ? '-' : '';
  const units: Array<[number, string]> = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const tenths = Math.trunc((abs * 10) / size);
      const whole = Math.trunc(tenths / 10);
      const decimal = tenths % 10;
      return `${sign}${decimal === 0 ? groupWestern(String(whole)) : `${whole}.${decimal}`}${suffix}`;
    }
  }
  return `${sign}${abs}`;
}

/**
 * A percentage value (already ×100): formatPct(1.312, { decimals: 2 }) →
 * "1.31%", formatPct(22, { signed: true }) → "+22%".
 */
export function formatPct(percent: number, opts: { decimals?: number; signed?: boolean } = {}): string {
  if (!Number.isFinite(percent)) return DASH;
  const { decimals = 0, signed = false } = opts;
  const body = Math.abs(percent).toFixed(decimals);
  const isZero = Number(body) === 0;
  const sign = percent < 0 && !isZero ? '-' : signed && percent > 0 && !isZero ? '+' : '';
  return `${sign}${body}%`;
}

/** numerator / denominator as a percentage: formatRate(4106, 312880, 2) → "1.31%"; "—" when the denominator is 0. */
export function formatRate(numerator: number, denominator: number, decimals = 2): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return DASH;
  return formatPct((numerator / denominator) * 100, { decimals });
}

/** An offer's payout: flat (minor units) or a percentage of the sale. */
export type OfferPayout =
  | { type: 'flat'; amountMinor: number; per: string }
  | { type: 'percent'; percent: number; per: string };

/** "₹180 / sign-up", "12% / sale". */
export function formatPayout(payout: OfferPayout): string {
  return payout.type === 'flat'
    ? `${formatINRFromMinor(payout.amountMinor)} / ${payout.per}`
    : `${formatPct(payout.percent)} / ${payout.per}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Calendar date parts; a Date or timestamp is read in India time (Asia/Kolkata). */
function calendarParts(date: string | Date): { y: number; m: number; d: number } | null {
  if (typeof date === 'string') {
    const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (plain) return { y: Number(plain[1]), m: Number(plain[2]), d: Number(plain[3]) };
  }
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return null;
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? { y, m, d } : null;
}

/**
 * "26 Sep" / "05 Sep" (pad, as in the 2c payouts table) / "Sat 3 Oct"
 * (weekday, as in the 1c next-payout line). A 'YYYY-MM-DD' string is a
 * calendar date; anything else is read in India time.
 */
export function formatDayMonth(date: string | Date, opts: { pad?: boolean; weekday?: boolean } = {}): string {
  const parts = calendarParts(date);
  if (!parts) return DASH;
  const day = opts.pad ? String(parts.d).padStart(2, '0') : String(parts.d);
  const label = `${day} ${MONTHS[parts.m - 1]}`;
  if (!opts.weekday) return label;
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay()];
  return `${weekday} ${label}`;
}

/** "21 Sep · 14:42": a timestamp as day, month and 24-hour time in India time (Asia/Kolkata). */
export function formatDayMonthTime(date: string | Date): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return DASH;
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(value);
  return `${formatDayMonth(value)} · ${time}`;
}
