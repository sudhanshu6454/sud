/**
 * Form validators for sign-up, onboarding, payouts, settings and link
 * building (design handover 2a / 3a / 3c / 2d). Each returns { ok, message } — message is
 * '' when ok — plus the normalised value to submit when there is one.
 *
 * These are client-side shape checks only. PAN is verified against the name
 * server-side, UPI IDs by the payout rail, GSTIN by the GST network; none of
 * that happens here, and a pass here proves nothing about ownership.
 */

export interface ValidationResult {
  ok: boolean;
  /** Human-readable reason when !ok ('' when ok). Show it under the field in accent-700. */
  message: string;
  /** Normalised value (trimmed, upper-cased, +91-prefixed …) when ok. */
  value?: string;
}

const pass = (value: string): ValidationResult => ({ ok: true, message: '', value });
const fail = (message: string): ValidationResult => ({ ok: false, message });

export interface OptionalRule {
  /** An empty value is valid (the field is optional). Default false. */
  optional?: boolean;
}

/**
 * Indian mobile number: +91 and 10 digits. Accepts spaces, hyphens and an
 * optional +91 / 91 / 0 prefix ("+91 98450 12345", "09845012345"). Indian
 * mobile numbers start with 6, 7, 8 or 9. Normalised to "+919845012345".
 */
export function validateMobile(input: string, rule: OptionalRule = {}): ValidationResult {
  const raw = input.trim();
  if (raw === '') return rule.optional ? pass('') : fail('Enter your mobile number.');
  if (!/^[+\d\s-]+$/.test(raw)) return fail('Use digits only: +91 and a 10-digit number.');
  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (hasPlus) {
    if (!digits.startsWith('91')) return fail('Only Indian (+91) mobile numbers are supported.');
    digits = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return fail('Enter a 10-digit mobile number after +91.');
  if (!/^[6-9]/.test(digits)) return fail('Indian mobile numbers start with 6, 7, 8 or 9.');
  return pass(`+91${digits}`);
}

/** One-time password: exactly 6 digits. */
export function validateOtp(input: string): ValidationResult {
  const raw = input.replace(/\s/g, '');
  if (raw === '') return fail('Enter the 6-digit code we sent by SMS.');
  if (!/^\d{6}$/.test(raw)) return fail('The code is 6 digits.');
  return pass(raw);
}

/** PAN: ^[A-Z]{5}[0-9]{4}[A-Z]$ (input is trimmed and upper-cased first). */
export function validatePan(input: string): ValidationResult {
  const raw = input.trim().toUpperCase();
  if (raw === '') return fail('Enter your PAN.');
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(raw)) {
    return fail('PAN is 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).');
  }
  return pass(raw);
}

/** UPI ID: ^[\w.\-]{2,}@[a-zA-Z]{2,}$ (e.g. name@bank). Trimmed; case kept. */
export function validateUpi(input: string): ValidationResult {
  const raw = input.trim();
  if (raw === '') return fail('Enter your UPI ID.');
  if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(raw)) return fail('A UPI ID looks like name@bank.');
  return pass(raw);
}

/**
 * GSTIN: 15 characters in the standard layout — 2-digit state code, the
 * holder's PAN, the entity number (1–9 or A–Z), "Z", a check character.
 * Optional by default (it is asked "only if registered"). The check
 * character is not verified here.
 */
export function validateGstin(input: string, rule: OptionalRule = { optional: true }): ValidationResult {
  const raw = input.trim().toUpperCase();
  if (raw === '') return rule.optional ? pass('') : fail('Enter your GSTIN.');
  if (raw.length !== 15) return fail('GSTIN is 15 characters.');
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(raw)) {
    return fail('That is not a valid GSTIN (e.g. 27ABCDE1234F1Z5).');
  }
  return pass(raw);
}

/** Sub-ID for a tracked link: a–z, 0–9 and hyphen, at most 32 characters. Optional by default. */
export function validateSubId(input: string, rule: OptionalRule = { optional: true }): ValidationResult {
  const raw = input.trim();
  if (raw === '') return rule.optional ? pass('') : fail('Enter a sub-ID.');
  if (raw.length > 32) return fail('A sub-ID is at most 32 characters.');
  if (!/^[a-z0-9-]+$/.test(raw)) return fail('Use lowercase letters, digits and hyphens only (e.g. reel-oct-01).');
  return pass(raw);
}

/**
 * Bank account number: 9 to 18 digits (the range Indian banks issue);
 * spaces and hyphens are ignored. Normalised to the digits. Shared by
 * onboarding (3a) and settings (2d); `emptyMessage` keeps each screen's
 * wording.
 */
export function validateBankAccount(input: string, emptyMessage = 'Enter your account number.'): ValidationResult {
  const raw = input.trim();
  if (raw === '') return fail(emptyMessage);
  if (!/^[\d\s-]+$/.test(raw)) return fail('Use digits only.');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 18) return fail('An account number is 9 to 18 digits.');
  return pass(digits);
}

/**
 * IFSC: 11 characters — 4 letters (the bank), a 0, then 6 letters or digits
 * (the branch): ^[A-Z]{4}0[A-Z0-9]{6}$. Trimmed and upper-cased first.
 * Shape only; no branch lookup. Shared by onboarding (3a) and settings (2d).
 */
export function validateIfsc(input: string, emptyMessage = 'Enter the branch IFSC.'): ValidationResult {
  const raw = input.trim().toUpperCase();
  if (raw === '') return fail(emptyMessage);
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw)) {
    return fail('IFSC is 11 characters: 4 letters, a 0, then 6 letters or digits.');
  }
  return pass(raw);
}
