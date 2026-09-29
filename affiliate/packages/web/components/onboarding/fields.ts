import type { Dispatch } from 'react';
import type { ErrorKey, OnboardingAction, OnboardingState, StepErrors, TextField } from '@/lib/onboarding';

/** DOM ids of the controls an error can sit on (focus goes to the first invalid one). */
export const FIELD_ID: Readonly<Record<ErrorKey, string>> = {
  role: 'join-role',
  fullName: 'join-full-name',
  mobile: 'join-mobile',
  otp: 'join-otp',
  platforms: 'join-platforms',
  pan: 'join-pan',
  upiId: 'join-upi',
  bankAccount: 'join-bank-account',
  ifsc: 'join-ifsc',
  gstin: 'join-gstin',
  consent: 'join-consent',
  legalName: 'join-legal-name',
  companyGstin: 'join-company-gstin',
  website: 'join-website',
  category: 'join-category',
  billingName: 'join-billing-name',
  billingEmail: 'join-billing-email',
  topUp: 'join-top-up',
  termsConsent: 'join-terms-consent',
};

/**
 * Move focus to the control an error sits on. Groups (the role cards, the
 * platform list) focus their selected / first control.
 */
export function focusField(key: ErrorKey): void {
  const el = document.getElementById(FIELD_ID[key]);
  if (!el) return;
  if (key === 'role') {
    const radio = el.querySelector<HTMLInputElement>('input:checked') ?? el.querySelector<HTMLInputElement>('input');
    radio?.focus();
    return;
  }
  if (key === 'platforms') {
    el.querySelector<HTMLElement>('button, input')?.focus();
    return;
  }
  el.focus();
}

/** What every step component receives. */
export interface StepProps {
  state: OnboardingState;
  errors: StepErrors;
  dispatch: Dispatch<OnboardingAction>;
  /** Polite announcement for assistive technology (demo actions, "Copied"). */
  announce: (message: string) => void;
}

/**
 * value / onChange / onBlur for a text control. The id goes on the <Field>
 * (id={FIELD_ID[field]}), which hands it to the control and its label.
 */
export function textProps(field: TextField, { state, dispatch }: Pick<StepProps, 'state' | 'dispatch'>) {
  return {
    value: state.form[field],
    onChange: (e: { target: { value: string } }) => dispatch({ type: 'setText', field, value: e.target.value }),
    onBlur: () => dispatch({ type: 'touch', field }),
  };
}
