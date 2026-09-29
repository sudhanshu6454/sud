import { describe, expect, it } from 'vitest';
import { DEMO_CONNECTED_ACCOUNTS, DEMO_PAN_HOLDER } from '../lib/demo/onboarding';
import {
  ROLE_OPTIONS,
  applicationBody,
  branchOf,
  connectedDetail,
  dashboardHref,
  emptyForm,
  fieldError,
  firstErrorKey,
  formatMobile,
  initialState,
  isStepComplete,
  joinSearch,
  initialRole,
  parsePlan,
  planFor,
  planSummary,
  onboardingReducer,
  onboardingStateLabel,
  parseRole,
  parseStep,
  reachableView,
  stepErrors,
  stepsFor,
  submitFailure,
  submitsLive,
  topUpMinor,
  validateBankAccount,
  validateChannel,
  validateEmail,
  validateFullName,
  validateIfsc,
  validateLegalName,
  validateTopUp,
  validateWebsite,
  visibleErrors,
  type OnboardingAction,
  type OnboardingForm,
  type OnboardingState,
  type Role,
} from '../lib/onboarding';

const run = (state: OnboardingState, ...actions: OnboardingAction[]) => actions.reduce(onboardingReducer, state);

/** A creator who has finished step 1 (OTP "sent" and a 6-digit code typed). */
function step1Done(role: Role = 'creator'): OnboardingState {
  return run(
    initialState(role),
    { type: 'setText', field: 'fullName', value: '  Demo   Priya Nair ' },
    { type: 'setText', field: 'mobile', value: '+91 60000 00001' },
    { type: 'sendOtp' },
    { type: 'setText', field: 'otp', value: '123456' },
  );
}

describe('roles, steps and the URL', () => {
  it('parses ?role= and ignores anything else', () => {
    expect(parseRole('creator')).toBe('creator');
    expect(parseRole(' Brand ')).toBe('brand');
    expect(parseRole(['agency', 'brand'])).toBe('agency');
    expect(parseRole('admin')).toBeNull();
    expect(parseRole('')).toBeNull();
    expect(parseRole(null)).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });

  it('parses ?step= (default 1)', () => {
    expect(parseStep('2')).toBe(2);
    expect(parseStep('3')).toBe(3);
    expect(parseStep('done')).toBe('done');
    expect(parseStep('4')).toBe(1);
    expect(parseStep('0')).toBe(1);
    expect(parseStep(null)).toBe(1);
  });

  it('has the four drawn account types in order', () => {
    expect(ROLE_OPTIONS.map((r) => r.title)).toEqual([
      'Creator / influencer',
      'Publisher',
      'Brand / advertiser',
      'Agency',
    ]);
  });

  it('branches creator / publisher vs brand / agency, with their step lists', () => {
    expect(branchOf('creator')).toBe('supply');
    expect(branchOf('publisher')).toBe('supply');
    expect(branchOf('brand')).toBe('business');
    expect(branchOf('agency')).toBe('business');
    expect(branchOf(null)).toBe('supply');
    expect(stepsFor('creator').map((s) => s.label)).toEqual([
      'Account type',
      'Connect platforms',
      'Payout details (PAN, UPI)',
    ]);
    expect(stepsFor('brand').map((s) => s.label)).toEqual(['Account type', 'Company details', 'Billing and wallet']);
  });

  it('builds the query string and the dashboard target', () => {
    expect(joinSearch('creator', 1)).toBe('?role=creator');
    expect(joinSearch('brand', 2)).toBe('?role=brand&step=2');
    expect(joinSearch(null, 'done')).toBe('?step=done');
    expect(joinSearch(null, 1)).toBe('');
    // A brand keeps the plan picked on the pricing page; other roles drop it.
    expect(joinSearch('brand', 3, 'starter')).toBe('?role=brand&plan=starter&step=3');
    expect(joinSearch('creator', 2, 'starter')).toBe('?role=creator&step=2');
    expect(dashboardHref('creator')).toBe('/app');
    expect(dashboardHref('publisher')).toBe('/app');
    expect(dashboardHref('brand')).toBe('/brand');
    expect(dashboardHref('agency')).toBe('/agency');
  });
});

describe('the pricing plan from the home page (?plan=)', () => {
  it('reads the plan and preselects the brand flow', () => {
    expect(parsePlan('starter')).toBe('starter');
    expect(parsePlan(' Network ')).toBe('network');
    expect(parsePlan('gold')).toBeNull();
    expect(parsePlan(null)).toBeNull();
    // The home page's "Start free" link: /join?role=brand&plan=starter
    expect(initialRole('brand', 'starter')).toBe('brand');
    expect(initialRole(null, 'starter')).toBe('brand');
    expect(initialRole('creator', 'starter')).toBe('creator');
    expect(initialRole(null, null)).toBeNull();
    expect(planFor('brand', 'starter')).toBe('starter');
    expect(planFor('agency', 'starter')).toBeNull();
  });

  it('shows the plan as the pricing section prints it', () => {
    expect(planSummary('starter')).toBe('Starter · ₹0 / month · 15% network fee on approved payouts');
    expect(planSummary('network')).toBe('Network · ₹24,999 / month · 8% network fee on approved payouts');
  });
});

describe('extra validators', () => {
  it('full name: 2–100 characters with a letter, spaces collapsed', () => {
    expect(validateFullName('  Demo   Priya  ')).toEqual({ ok: true, message: '', value: 'Demo Priya' });
    expect(validateFullName('प्रिया नायर').ok).toBe(true);
    for (const bad of ['', ' ', 'P', '1234', 'x'.repeat(101)]) expect(validateFullName(bad).ok).toBe(false);
  });

  it('legal name: 2–200 characters', () => {
    expect(validateLegalName('Demo PayUPI Private Limited').ok).toBe(true);
    expect(validateLegalName('').message).toBe('Enter the registered company name.');
    expect(validateLegalName('a'.repeat(201)).ok).toBe(false);
  });

  it('bank account: 9–18 digits, spaces and hyphens ignored', () => {
    expect(validateBankAccount('1234 5678 9012')).toEqual({ ok: true, message: '', value: '123456789012' });
    expect(validateBankAccount('123456789').ok).toBe(true);
    expect(validateBankAccount('1'.repeat(18)).ok).toBe(true);
    for (const bad of ['', '12345678', '1'.repeat(19), '12345678A', 'ABCDEFGHIJ']) {
      expect(validateBankAccount(bad).ok).toBe(false);
    }
  });

  it('IFSC: 4 letters, 0, 6 letters or digits (upper-cased)', () => {
    expect(validateIfsc(' abcd0123456 ')).toEqual({ ok: true, message: '', value: 'ABCD0123456' });
    expect(validateIfsc('DEMO0A1B2C3').ok).toBe(true);
    for (const bad of ['', 'ABCD1234567', 'ABC00123456', 'ABCD012345', 'ABCD01234567', 'ABCD0-23456']) {
      expect(validateIfsc(bad).ok).toBe(false);
    }
  });

  it('website: http(s) with a dotted host; https:// added', () => {
    expect(validateWebsite('shop.example.com').value).toBe('https://shop.example.com');
    expect(validateWebsite('https://shop.example.com/').value).toBe('https://shop.example.com');
    expect(validateWebsite('http://shop.example.com/in/deals').value).toBe('http://shop.example.com/in/deals');
    for (const bad of [
      '',
      'localhost',
      'ftp://shop.example.com',
      'shop example.com',
      'https://user:pw@shop.example.com',
      'https://shop.example.1',
    ]) {
      expect(validateWebsite(bad).ok).toBe(false);
    }
    expect(validateWebsite('', { optional: true }).ok).toBe(true);
  });

  it('channel: a Telegram username becomes t.me, anything else must be a website', () => {
    expect(validateChannel('@demodeals').value).toBe('https://t.me/demodeals');
    expect(validateChannel('t.me/demodeals').value).toBe('https://t.me/demodeals');
    expect(validateChannel('https://telegram.me/demo_deals/').value).toBe('https://t.me/demo_deals');
    expect(validateChannel('deals.example.com').value).toBe('https://deals.example.com');
    for (const bad of ['', 't.me/+AbCdEf', 't.me/abc', '@1demo', 'not a url'])
      expect(validateChannel(bad).ok).toBe(false);
  });

  it('email', () => {
    expect(validateEmail(' billing@example.com ').value).toBe('billing@example.com');
    for (const bad of ['', 'billing', 'billing@', 'billing@example', 'a b@example.com', 'billing@example.c']) {
      expect(validateEmail(bad).ok).toBe(false);
    }
  });

  it('top-up: optional whole rupees, grouping allowed, kept in paise', () => {
    expect(validateTopUp('')).toEqual({ ok: true, message: '', value: '' });
    expect(validateTopUp('₹1,00,000').value).toBe('100000');
    expect(validateTopUp('25,000').value).toBe('25000');
    expect(validateTopUp('007').value).toBe('7');
    for (const bad of ['0', '000', '12.50', '-500', 'abc', '1234567890']) expect(validateTopUp(bad).ok).toBe(false);
    expect(validateTopUp('', { optional: false }).ok).toBe(false);
    expect(topUpMinor('25,000')).toBe(2_500_000);
    expect(Number.isInteger(topUpMinor('999999999'))).toBe(true);
    expect(topUpMinor('')).toBeNull();
    expect(topUpMinor('12.5')).toBeNull();
  });

  it('formats a normalised mobile number', () => {
    expect(formatMobile('+916000000001')).toBe('+91 60000 00001');
    expect(formatMobile('')).toBe('');
  });
});

describe('reducer', () => {
  it('starts empty with the preselected role and UPI', () => {
    const s = initialState('publisher');
    expect(s.form.role).toBe('publisher');
    expect(s.form.payoutMethod).toBe('upi');
    expect(Object.values(s.form.connected).some(Boolean)).toBe(false);
    expect(s.touched).toEqual({});
    expect(s.attempted).toEqual({});
  });

  it('upper-cases PAN / IFSC / GSTIN and keeps the OTP to 6 digits', () => {
    const s = run(
      initialState('creator'),
      { type: 'setText', field: 'pan', value: 'abc pn1234k' },
      { type: 'setText', field: 'ifsc', value: 'abcd0123456' },
      { type: 'setText', field: 'gstin', value: '27abcde1234f1z5' },
      { type: 'setText', field: 'otp', value: '12a3 4567' },
    );
    expect(s.form.pan).toBe('ABCPN1234K');
    expect(s.form.ifsc).toBe('ABCD0123456');
    expect(s.form.gstin).toBe('27ABCDE1234F1Z5');
    expect(s.form.otp).toBe('123456');
  });

  it('Send OTP records a valid number, and marks an invalid one touched', () => {
    const bad = run(initialState('creator'), { type: 'setText', field: 'mobile', value: '12345' }, { type: 'sendOtp' });
    expect(bad.form.otpSentTo).toBeNull();
    expect(bad.touched.mobile).toBe(true);
    const empty = run(initialState('creator'), { type: 'sendOtp' });
    expect(empty.touched.mobile).toBe(true);
    expect(visibleErrors(empty, 1).mobile).toBe('Enter your mobile number.');

    const ok = run(
      initialState('creator'),
      { type: 'setText', field: 'mobile', value: '60000 00001' },
      { type: 'sendOtp' },
    );
    expect(ok.form.otpSentTo).toBe('+916000000001');
  });

  it('a code sent to another number stops counting when the number changes', () => {
    const s = step1Done();
    const reformatted = run(s, { type: 'setText', field: 'mobile', value: '6000000001' });
    expect(reformatted.form.otpSentTo).toBe('+916000000001');
    expect(reformatted.form.otp).toBe('123456');
    const changed = run(s, { type: 'setText', field: 'mobile', value: '+91 60000 00002' });
    expect(changed.form.otpSentTo).toBeNull();
    expect(changed.form.otp).toBe('');
  });

  it('toggles demo platforms and stores only a valid channel', () => {
    let s = run(initialState('creator'), { type: 'togglePlatform', platform: 'instagram' });
    expect(s.form.connected.instagram).toBe(true);
    s = run(s, { type: 'togglePlatform', platform: 'instagram' });
    expect(s.form.connected.instagram).toBe(false);
    s = run(s, { type: 'setChannel', value: 'not a url' });
    expect(s.form.channel).toBe('');
    s = run(s, { type: 'setChannel', value: '@demodeals' });
    expect(s.form.channel).toBe('https://t.me/demodeals');
    s = run(s, { type: 'setChannel', value: '' });
    expect(s.form.channel).toBe('');
  });

  it('leaving an empty field touches nothing; leaving a filled one does', () => {
    let s = run(initialState('creator'), { type: 'touch', field: 'fullName' });
    expect(s.touched.fullName).toBeUndefined();
    s = run(s, { type: 'setText', field: 'fullName', value: 'P' }, { type: 'touch', field: 'fullName' });
    expect(s.touched.fullName).toBe(true);
    expect(visibleErrors(s, 1)).toEqual({ fullName: 'Enter the full name, not an initial.' });
  });

  it('keeps every field across a role change (Back never loses input)', () => {
    const s = run(
      step1Done(),
      { type: 'setRole', role: 'brand' },
      { type: 'setText', field: 'legalName', value: 'Demo PayUPI' },
    );
    const back = run(s, { type: 'setRole', role: 'creator' });
    expect(back.form.fullName).toBe('  Demo   Priya Nair ');
    expect(back.form.legalName).toBe('Demo PayUPI');
    expect(back.form.otpSentTo).toBe('+916000000001');
  });
});

describe('step validation', () => {
  it('step 1 needs a role, a name, a mobile with an OTP sent, and a 6-digit code', () => {
    const none = stepErrors(emptyForm(), 1);
    expect(Object.keys(none)).toEqual(['role', 'fullName', 'mobile']);
    expect(none.role).toBe('Choose how you will use Afflino.');

    const notSent = run(
      initialState('creator'),
      { type: 'setText', field: 'fullName', value: 'Demo Priya' },
      { type: 'setText', field: 'mobile', value: '6000000001' },
    );
    expect(stepErrors(notSent.form, 1)).toEqual({ mobile: 'Send the OTP to verify this number.' });

    const badCode = run(notSent, { type: 'sendOtp' }, { type: 'setText', field: 'otp', value: '12' });
    expect(stepErrors(badCode.form, 1)).toEqual({ otp: 'The code is 6 digits.' });

    expect(isStepComplete(step1Done().form, 1)).toBe(true);
  });

  it('the impossible demo mobile number never passes', () => {
    const s = run(
      initialState('creator'),
      { type: 'setText', field: 'mobile', value: '+91 00000 00000' },
      { type: 'sendOtp' },
    );
    expect(s.form.otpSentTo).toBeNull();
    expect(fieldError(s.form, 'mobile')).toBeDefined();
  });

  it('supply step 2 needs one platform or a channel', () => {
    const s = step1Done();
    expect(stepErrors(s.form, 2)).toEqual({
      platforms: 'Connect at least one platform, or add a website or Telegram channel, to continue.',
    });
    expect(isStepComplete(run(s, { type: 'togglePlatform', platform: 'snapchat' }).form, 2)).toBe(true);
    expect(isStepComplete(run(s, { type: 'setChannel', value: 'deals.example.com' }).form, 2)).toBe(true);
  });

  it('supply step 3: PAN, UPI or bank, optional GSTIN, consent — in screen order', () => {
    const s = step1Done();
    expect(Object.keys(stepErrors(s.form, 3))).toEqual(['pan', 'upiId', 'consent']);
    const bank = run(s, { type: 'setPayoutMethod', method: 'bank' });
    expect(Object.keys(stepErrors(bank.form, 3))).toEqual(['pan', 'bankAccount', 'ifsc', 'consent']);
    const filled = run(
      bank,
      { type: 'setText', field: 'pan', value: 'abcpn1234k' },
      { type: 'setText', field: 'bankAccount', value: '1234 5678 9012' },
      { type: 'setText', field: 'ifsc', value: 'DEMO0123456' },
      { type: 'setText', field: 'gstin', value: '27ABCDE1234F' },
      { type: 'setConsent', field: 'consent', value: true },
    );
    expect(stepErrors(filled.form, 3)).toEqual({ gstin: 'GSTIN is 15 characters.' });
    const done = run(filled, { type: 'setText', field: 'gstin', value: '' });
    expect(isStepComplete(done.form, 3)).toBe(true);
    // Switching back to UPI asks for the UPI ID; the bank fields are kept.
    const upi = run(done, { type: 'setPayoutMethod', method: 'upi' });
    expect(Object.keys(stepErrors(upi.form, 3))).toEqual(['upiId']);
    expect(upi.form.bankAccount).toBe('1234 5678 9012');
  });

  it('business steps: company details, then billing with an optional top-up and the terms', () => {
    const s = step1Done('brand');
    expect(Object.keys(stepErrors(s.form, 2))).toEqual(['legalName', 'website', 'category']);
    const company = run(
      s,
      { type: 'setText', field: 'legalName', value: 'Demo PayUPI Private Limited' },
      { type: 'setText', field: 'website', value: 'shop.example.com' },
      { type: 'setText', field: 'category', value: 'Fintech' },
    );
    expect(isStepComplete(company.form, 2)).toBe(true);
    expect(Object.keys(stepErrors(company.form, 3))).toEqual(['billingName', 'billingEmail', 'termsConsent']);
    const billing = run(
      company,
      { type: 'setText', field: 'billingName', value: 'Demo Billing' },
      { type: 'setText', field: 'billingEmail', value: 'billing@example.com' },
      { type: 'setText', field: 'topUp', value: '12.50' },
      { type: 'setConsent', field: 'termsConsent', value: true },
    );
    expect(stepErrors(billing.form, 3)).toEqual({ topUp: 'Whole rupees only, e.g. 25,000.' });
    expect(isStepComplete(run(billing, { type: 'setText', field: 'topUp', value: '25,000' }).form, 3)).toBe(true);
    // The supply consent is not asked of a brand.
    expect(stepErrors(billing.form, 3).consent).toBeUndefined();
  });

  it('shows nothing before an attempt except touched fields; everything after', () => {
    const s = initialState('creator');
    expect(visibleErrors(s, 1)).toEqual({});
    const attempted = run(s, { type: 'attempt', step: 1 });
    expect(Object.keys(visibleErrors(attempted, 1))).toEqual(['fullName', 'mobile']);
    // Cross-field errors (OTP not sent) wait for the attempt even on a touched field.
    const touched = run(
      s,
      { type: 'setText', field: 'mobile', value: '6000000001' },
      { type: 'touch', field: 'mobile' },
    );
    expect(visibleErrors(touched, 1)).toEqual({});
    expect(visibleErrors(run(touched, { type: 'attempt', step: 1 }), 1).mobile).toBe(
      'Send the OTP to verify this number.',
    );
  });

  it('the first error in screen order gets focus', () => {
    expect(firstErrorKey(stepErrors(emptyForm(), 1))).toBe('role');
    expect(firstErrorKey(stepErrors(emptyForm('creator'), 1))).toBe('fullName');
    expect(firstErrorKey({})).toBeNull();
  });
});

describe('reachable view (URL clamping)', () => {
  it('clamps a step whose earlier steps are incomplete', () => {
    const empty = emptyForm('creator');
    expect(reachableView(empty, 3, false)).toBe(1);
    expect(reachableView(empty, 1, false)).toBe(1);
    const s1 = step1Done().form;
    expect(reachableView(s1, 2, false)).toBe(2);
    expect(reachableView(s1, 3, false)).toBe(2);
    const s2: OnboardingForm = { ...s1, connected: { ...s1.connected, youtube: true } };
    expect(reachableView(s2, 3, false)).toBe(3);
  });

  it("'done' needs a finished submission", () => {
    const s1 = step1Done().form;
    expect(reachableView(s1, 'done', false)).toBe(2);
    expect(reachableView(emptyForm(), 'done', true)).toBe('done');
  });
});

describe('submission', () => {
  it('sends the full name as legal_name and country IN', () => {
    expect(applicationBody(step1Done().form)).toEqual({ legal_name: 'Demo Priya Nair', country: 'IN' });
  });

  it('only creators and publishers with a token submit live', () => {
    expect(submitsLive('creator', true)).toBe(true);
    expect(submitsLive('publisher', true)).toBe(true);
    expect(submitsLive('creator', false)).toBe(false);
    expect(submitsLive('brand', true)).toBe(false);
    expect(submitsLive('agency', true)).toBe(false);
    expect(submitsLive(null, true)).toBe(false);
  });

  it('maps failures: unreachable → labelled demo, refusals → a message', () => {
    expect(submitFailure('NETWORK_UNREACHABLE', 'x')).toEqual({ kind: 'fallback' });
    expect(submitFailure('UPSTREAM_UNAVAILABLE', 'x')).toEqual({ kind: 'fallback' });
    for (const code of ['UNAUTHORIZED', 'FORBIDDEN', 'VALIDATION_ERROR', 'RATE_LIMITED', 'INTERNAL', 'CONFLICT']) {
      const f = submitFailure(code, 'Invalid request: legal_name: too long');
      expect(f.kind).toBe('error');
      if (f.kind === 'error') expect(f.message.length).toBeGreaterThan(10);
    }
    const v = submitFailure('VALIDATION_ERROR', 'Invalid request: legal_name: too long');
    expect(v.kind === 'error' && v.message).toContain('legal_name: too long');
    const f = submitFailure('FORBIDDEN', '');
    expect(f.kind === 'error' && f.message).toContain('publisher_owner');
  });

  it('labels the API onboarding states', () => {
    expect(onboardingStateLabel('application')).toBe('Application received');
    expect(onboardingStateLabel('active')).toBe('Active');
    expect(onboardingStateLabel('something_new')).toBe('something_new');
  });
});

describe('demo connections', () => {
  it('prints the rows as 3a does, with TEST names', () => {
    expect(connectedDetail(DEMO_CONNECTED_ACCOUNTS.instagram)).toBe('@demo.priyanair · 1.2M · 84% India');
    expect(connectedDetail(DEMO_CONNECTED_ACCOUNTS.youtube)).toBe('Demo Priya Nair Money · 310K');
    for (const account of Object.values(DEMO_CONNECTED_ACCOUNTS)) {
      expect(account.handle.toLowerCase()).toMatch(/^@?demo[ .]/);
    }
    expect(DEMO_PAN_HOLDER.startsWith('DEMO ')).toBe(true);
  });
});
