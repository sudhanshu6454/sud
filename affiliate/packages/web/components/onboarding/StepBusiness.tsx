'use client';

import Link from 'next/link';
import { Checkbox, Field, Input, Select } from '@/components/ui';
import { formatINRWhole } from '@/lib/format';
import { BUSINESS_CATEGORIES, validateTopUp } from '@/lib/onboarding';
import { DemoNote } from './DemoNote';
import { FIELD_ID, textProps, type StepProps } from './fields';
import styles from './Onboarding.module.css';

const CATEGORY_OPTIONS = BUSINESS_CATEGORIES.map((c) => ({ value: c, label: c }));

/** Business step 2 (brand / agency; not drawn — the 3a field pattern): legal name, website, category, GSTIN. */
export function StepCompany({ state, errors, dispatch }: StepProps) {
  const { form } = state;
  const wire = { state, dispatch };
  return (
    <>
      <Field label="Legal name" id={FIELD_ID.legalName} error={errors.legalName} required>
        <Input {...textProps('legalName', wire)} autoComplete="organization" maxLength={200} />
      </Field>
      <Field label="Website" id={FIELD_ID.website} error={errors.website} required>
        <Input
          {...textProps('website', wire)}
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://"
          maxLength={300}
        />
      </Field>
      <div className={styles.pair}>
        <Field
          label={form.role === 'agency' ? 'Main category' : 'Category'}
          id={FIELD_ID.category}
          error={errors.category}
          required
        >
          <Select
            value={form.category}
            onChange={(e) => {
              dispatch({ type: 'setText', field: 'category', value: e.target.value });
              dispatch({ type: 'touch', field: 'category' });
            }}
            placeholder="Choose a category"
            options={CATEGORY_OPTIONS}
          />
        </Field>
        <Field label="GSTIN (optional)" id={FIELD_ID.companyGstin} error={errors.companyGstin}>
          <Input
            {...textProps('companyGstin', wire)}
            placeholder="Only if registered"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={15}
          />
        </Field>
      </div>
    </>
  );
}

/**
 * Business step 3 (not drawn): billing contact and a wallet top-up amount.
 * No payments provider exists: the amount is recorded in the page only and
 * nothing is charged.
 */
export function StepBilling({ state, errors, dispatch }: StepProps) {
  const { form } = state;
  const wire = { state, dispatch };
  const topUp = validateTopUp(form.topUp);
  const amount = topUp.ok && topUp.value ? formatINRWhole(Number(topUp.value)) : null;
  return (
    <>
      <div className={styles.pair}>
        <Field label="Billing contact" id={FIELD_ID.billingName} error={errors.billingName} required>
          <Input {...textProps('billingName', wire)} autoComplete="name" maxLength={100} />
        </Field>
        <Field label="Billing email" id={FIELD_ID.billingEmail} error={errors.billingEmail} required>
          <Input
            {...textProps('billingEmail', wire)}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
          />
        </Field>
      </div>
      <Field
        label="Wallet top-up, ₹ (optional)"
        id={FIELD_ID.topUp}
        error={errors.topUp}
        hint={
          amount ? `${amount} — shown for the demo only; nothing is charged.` : 'Whole rupees. You can top up later.'
        }
      >
        <Input
          {...textProps('topUp', wire)}
          inputMode="numeric"
          autoComplete="off"
          maxLength={14}
          aria-describedby="join-topup-demo"
        />
      </Field>
      <DemoNote id="join-topup-demo">
        No payment is taken and no wallet is created: there is no payments provider yet.
      </DemoNote>
      <div>
        <Checkbox
          id={FIELD_ID.termsConsent}
          checked={form.termsConsent}
          onChange={(e) => dispatch({ type: 'setConsent', field: 'termsConsent', value: e.target.checked })}
          invalid={Boolean(errors.termsConsent)}
          aria-describedby={errors.termsConsent ? 'join-terms-error' : undefined}
        >
          I agree to the{' '}
          <Link href="/terms" target="_blank" rel="noopener" className={styles.inlineLink}>
            Terms of use<span className="sr-only"> (opens in a new tab)</span>
          </Link>
          .
        </Checkbox>
        {errors.termsConsent ? (
          <p id="join-terms-error" className={styles.groupError} role="alert">
            {errors.termsConsent}
          </p>
        ) : null}
      </div>
    </>
  );
}
