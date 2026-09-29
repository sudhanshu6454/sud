/**
 * Exact decimal text → integer minor units, for provider files that print
 * money as decimals (the Amazon.in Associates earnings report prints rupees:
 * "1,299.00"). Invariant 1 still holds: the result is an integer number of
 * minor units, computed from the digits with BigInt, never through a float,
 * and never rounded — a value that does not convert exactly is refused.
 *
 * Accepted (and nothing else):
 *   - an optional leading '-' (only when `allowNegative`);
 *   - an integer part: '0', or digits without a leading zero, optionally
 *     grouped with commas in the Western (1,234,567) or the Indian
 *     (12,34,567) pattern;
 *   - an optional fraction of EXACTLY `fractionDigits` digits after a '.'
 *     (2 for INR: "12.50" yes, "12.5" and "12.505" no).
 * Refused: blanks, spaces inside the number, currency symbols, exponents,
 * '+', parentheses, a leading/trailing '.', mixed or malformed grouping, and
 * any value beyond Number.MAX_SAFE_INTEGER minor units.
 */

export type DecimalParse = { ok: true; minor: number } | { ok: false; reason: string };

export interface DecimalParseOptions {
  /** Minor-unit digits of the currency (2 for INR). Default 2. */
  fractionDigits?: number;
  /** Accept a leading '-' (returns / refunds). Default false. */
  allowNegative?: boolean;
}

const PLAIN_INT = /^(0|[1-9]\d*)$/;
const WESTERN_GROUPED = /^[1-9]\d{0,2}(,\d{3})+$/;
const INDIAN_GROUPED = /^[1-9]\d{0,1}(,\d{2})*,\d{3}$/;

export function parseDecimalMinorUnits(raw: string, opts: DecimalParseOptions = {}): DecimalParse {
  const fractionDigits = opts.fractionDigits ?? 2;
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new Error(`parseDecimalMinorUnits: unsupported fractionDigits ${fractionDigits}`);
  }
  const text = raw.trim();
  if (text === '') return { ok: false, reason: 'empty value' };

  let body = text;
  let negative = false;
  if (body.startsWith('-')) {
    if (!opts.allowNegative) return { ok: false, reason: `negative value '${text}' not allowed here` };
    negative = true;
    body = body.slice(1);
  }

  const parts = body.split('.');
  if (parts.length > 2) return { ok: false, reason: `'${text}' has more than one decimal point` };
  if (!/^[0-9,]*(\.[0-9]*)?$/.test(body)) return { ok: false, reason: `'${text}' is not a plain decimal number` };
  const intPart = parts[0] ?? '';
  const fracPart = parts.length === 2 ? (parts[1] ?? '') : null;

  if (fracPart !== null) {
    if (fractionDigits === 0) return { ok: false, reason: `'${text}' has a fraction; whole units expected` };
    if (!/^\d+$/.test(fracPart) || fracPart.length !== fractionDigits) {
      return {
        ok: false,
        reason: `'${text}' must have exactly ${fractionDigits} digits after the decimal point (never rounded)`,
      };
    }
  }

  let digits: string;
  if (PLAIN_INT.test(intPart)) digits = intPart;
  else if (WESTERN_GROUPED.test(intPart) || INDIAN_GROUPED.test(intPart)) digits = intPart.replace(/,/g, '');
  else return { ok: false, reason: `'${text}' is not a plain decimal number` };

  const minorBig = BigInt(digits) * 10n ** BigInt(fractionDigits) + BigInt(fracPart ?? '0');
  if (minorBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: `'${text}' exceeds the largest supported amount` };
  }
  const minor = Number(minorBig);
  // -0 → 0: a negative zero is still zero minor units.
  return { ok: true, minor: negative && minor !== 0 ? -minor : 0 + minor };
}
