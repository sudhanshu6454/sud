'use client';

/*
 * "Top up wallet" (billing). A clearly-labelled demo: no payments provider
 * is connected, so after the amount and method are chosen the dialog says
 * that nothing was charged and the balance is unchanged. It never asks for
 * card, bank or UPI credentials.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, Segmented, TagButton } from '@/components/ui';
import { DEMO_TOP_UP_PRESETS_RUPEES } from '@/lib/demo/brand';
import { formatINRCompactFromMinor, formatINRFromMinor } from '@/lib/format';
import { TOP_UP_METHODS, validateTopUp, type TopUpMethod } from './billingModel';
import styles from './TopUpDialog.module.css';

export interface TopUpDialogProps {
  open: boolean;
  onClose: () => void;
  walletMinor: number;
}

export function TopUpDialog({ open, onClose, walletMinor }: TopUpDialogProps) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<TopUpMethod>('upi');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<{ minor: number; method: TopUpMethod } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setAmount('');
      setMethod('upi');
      setTouched(false);
      setDone(null);
    }
  }, [open]);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const check = validateTopUp(amount);
  const methodLabel = (m: TopUpMethod) => TOP_UP_METHODS.find((x) => x.value === m)?.label ?? m;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!check.ok) {
      amountRef.current?.focus();
      return;
    }
    setDone({ minor: check.minor, method });
  };

  if (done) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Demo top-up: nothing was charged"
        actions={
          <Button ref={doneRef} variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p className={styles.copy}>
          No payment was taken and the wallet stays at {formatINRCompactFromMinor(walletMinor)}: no payments provider
          is connected yet.
        </p>
        <p className={styles.copy}>
          With one connected, you would pay {formatINRFromMinor(done.minor)} by {methodLabel(done.method)} and the
          balance would update once the payment clears.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Top up wallet"
      initialFocusRef={amountRef}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" arrow type="submit" form="top-up-form">
            Continue (demo)
          </Button>
        </>
      }
    >
      <form id="top-up-form" className={styles.form} onSubmit={onSubmit} noValidate>
        <p className={styles.demo}>Demo: no payment is taken. No payments provider is connected.</p>
        <Field
          label="Amount (₹)"
          hint={`Wallet now ${formatINRCompactFromMinor(walletMinor)}. Approved conversions are paid from it.`}
          error={touched && !check.ok ? check.message : undefined}
          required
        >
          <Input
            ref={amountRef}
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            placeholder="₹5,00,000"
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <div className={styles.presets} role="group" aria-label="Quick amounts">
          {DEMO_TOP_UP_PRESETS_RUPEES.map((r) => {
            const label = formatINRCompactFromMinor(r * 100);
            const selected = check.ok && check.minor === r * 100;
            return (
              <TagButton
                key={r}
                selected={selected}
                className={styles.preset}
                onClick={() => {
                  setAmount(formatINRFromMinor(r * 100));
                  setTouched(false);
                }}
                aria-label={`${formatINRFromMinor(r * 100)}`}
              >
                {label}
              </TagButton>
            );
          })}
        </div>
        <Field label="Pay by">
          <Segmented block options={TOP_UP_METHODS} value={method} onChange={setMethod} />
        </Field>
      </form>
    </Dialog>
  );
}
