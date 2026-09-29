'use client';

import { useEffect, useRef } from 'react';
import { Button, Field, Input, SelectableCardGroup } from '@/components/ui';
import { ROLE_OPTIONS, formatMobile, type Role } from '@/lib/onboarding';
import { validateMobile } from '@/lib/validators';
import { DemoNote } from './DemoNote';
import { FIELD_ID, textProps, type StepProps } from './fields';
import styles from './Onboarding.module.css';

/**
 * Step 1 (2a): account type, full name, mobile with the demo OTP flow. No
 * SMS provider exists: "Send OTP" only records the number and reveals the
 * code field, which accepts any 6 digits (validateOtp) and checks nothing.
 */
export function StepAccount({ state, errors, dispatch, announce }: StepProps) {
  const { form } = state;
  const mobile = validateMobile(form.mobile);
  const sent = form.otpSentTo !== null && form.otpSentTo === mobile.value;
  const focusOtp = useRef(false);

  useEffect(() => {
    if (sent && focusOtp.current) {
      focusOtp.current = false;
      document.getElementById(FIELD_ID.otp)?.focus();
    }
  }, [sent]);

  function sendOtp() {
    if (!mobile.ok) {
      dispatch({ type: 'sendOtp' }); // marks the field touched, so its error shows
      document.getElementById(FIELD_ID.mobile)?.focus();
      return;
    }
    announce('Demo: no SMS was sent. Enter any 6 digits as the code.');
    if (sent) {
      document.getElementById(FIELD_ID.otp)?.focus(); // "Resend": nothing to send, back to the code
      return;
    }
    focusOtp.current = true;
    dispatch({ type: 'sendOtp' });
  }

  return (
    <>
      <div id={FIELD_ID.role} className={styles.roleGroup}>
        <SelectableCardGroup<Role>
          label="Account type"
          name="role"
          options={ROLE_OPTIONS}
          value={form.role}
          onChange={(role) => dispatch({ type: 'setRole', role })}
        />
        {errors.role ? (
          <p className={styles.groupError} role="alert">
            {errors.role}
          </p>
        ) : null}
      </div>

      <div className={styles.pair}>
        <Field label="Full name" id={FIELD_ID.fullName} error={errors.fullName} required>
          <Input {...textProps('fullName', { state, dispatch })} autoComplete="name" maxLength={100} />
        </Field>
        <Field label="Mobile (OTP)" id={FIELD_ID.mobile} error={errors.mobile} required>
          <div className={styles.otpBox}>
            <Input
              {...textProps('mobile', { state, dispatch })}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 00000 00000"
              maxLength={17}
              className={styles.otpInput}
              onKeyDown={(e) => {
                // Enter sends the code first; once sent, Enter submits the form as usual.
                if (e.key === 'Enter' && !sent) {
                  e.preventDefault();
                  sendOtp();
                }
              }}
            />
            <Button variant="ghost" size="sm" className={styles.otpSend} onClick={sendOtp}>
              {sent ? 'Resend' : 'Send OTP'}
            </Button>
          </div>
        </Field>
        {sent ? (
          <>
            <Field label="6-digit code" id={FIELD_ID.otp} error={errors.otp} required className={styles.otpField}>
              <Input
                {...textProps('otp', { state, dispatch })}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                aria-describedby="join-otp-demo"
              />
            </Field>
            <DemoNote id="join-otp-demo" className={styles.otpNote}>
              No SMS was sent to {formatMobile(mobile.value ?? '')}. Enter any 6 digits; nothing is checked.
            </DemoNote>
          </>
        ) : null}
      </div>
    </>
  );
}
