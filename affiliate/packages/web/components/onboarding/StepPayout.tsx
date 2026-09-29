'use client';

import Link from 'next/link';
import { DemoPanHint } from '@/components/DemoPanHint';
import { Checkbox, Field, Input, Segmented } from '@/components/ui';
import { DEMO_PAN_HOLDER } from '@/lib/demo/onboarding';
import type { PayoutMethod } from '@/lib/onboarding';
import { validatePan } from '@/lib/validators';
import { FIELD_ID, textProps, type StepProps } from './fields';
import styles from './Onboarding.module.css';

const METHODS = [
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
] as const satisfies ReadonlyArray<{ value: PayoutMethod; label: string }>;

/**
 * Supply step 3 (3a right half): PAN, payout method (UPI | bank transfer),
 * optional GSTIN and the consent. No KYC provider exists: a PAN that passes
 * the format check shows the design's "Verified" line with the TEST holder
 * name, labelled as a demo — nothing is checked against any register.
 */
export function StepPayout({ state, errors, dispatch }: StepProps) {
  const { form } = state;
  const panOk = validatePan(form.pan).ok;
  const wire = { state, dispatch };

  return (
    <>
      <Field
        label="PAN"
        id={FIELD_ID.pan}
        error={errors.pan}
        required
        hintTone="accent"
        hint={
          panOk ? <DemoPanHint name={DEMO_PAN_HOLDER} /> : undefined
        }
      >
        <Input
          {...textProps('pan', wire)}
          maxLength={10}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </Field>

      <Field label="Payout method">
        <Segmented<PayoutMethod>
          block
          className={styles.segTouch}
          name="payout-method"
          options={METHODS}
          value={form.payoutMethod}
          onChange={(method) => dispatch({ type: 'setPayoutMethod', method })}
        />
      </Field>

      {form.payoutMethod === 'upi' ? (
        <Field label="UPI ID" id={FIELD_ID.upiId} error={errors.upiId} required>
          <Input
            {...textProps('upiId', wire)}
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@bank"
            maxLength={100}
          />
        </Field>
      ) : (
        <div className={styles.pair}>
          <Field label="Account number" id={FIELD_ID.bankAccount} error={errors.bankAccount} required>
            <Input {...textProps('bankAccount', wire)} inputMode="numeric" autoComplete="off" maxLength={22} />
          </Field>
          <Field label="IFSC" id={FIELD_ID.ifsc} error={errors.ifsc} required>
            <Input
              {...textProps('ifsc', wire)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={11}
            />
          </Field>
        </div>
      )}

      <Field label="GSTIN (optional)" id={FIELD_ID.gstin} error={errors.gstin}>
        <Input
          {...textProps('gstin', wire)}
          placeholder="Only if registered"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={15}
        />
      </Field>

      <div>
        <Checkbox
          id={FIELD_ID.consent}
          checked={form.consent}
          onChange={(e) => dispatch({ type: 'setConsent', field: 'consent', value: e.target.checked })}
          invalid={Boolean(errors.consent)}
          aria-describedby={errors.consent ? 'join-consent-error' : undefined}
        >
          I agree to the{' '}
          <Link href="/terms" target="_blank" rel="noopener" className={styles.inlineLink}>
            Creator Terms<span className="sr-only"> (opens in a new tab)</span>
          </Link>{' '}
          and ASCI influencer disclosure guidelines.
        </Checkbox>
        {errors.consent ? (
          <p id="join-consent-error" className={styles.groupError} role="alert">
            {errors.consent}
          </p>
        ) : null}
      </div>
    </>
  );
}
