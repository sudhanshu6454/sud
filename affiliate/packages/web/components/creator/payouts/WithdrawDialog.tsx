'use client';

/*
 * Withdraw (2c): a confirm dialog with the amount, TDS and net, then a
 * success state. Demo mode runs the designed flow against TEST data and says
 * so — nothing is sent anywhere. Live mode has no publisher withdrawal
 * endpoint to call (payouts are finance-prepared batches with maker-checker,
 * packages/api/src/routes/payouts.ts), so it explains that instead and moves
 * no money.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { formatINRFromMinor } from '@/lib/format';
import { MIN_WITHDRAWAL_RUPEES } from '@/lib/site-copy';
import { tdsLabel, validateWithdrawAmount, withdrawalBreakdown, type WithdrawalBreakdown } from './model';
import styles from './WithdrawDialog.module.css';

export interface WithdrawDialogProps {
  open: boolean;
  onClose: () => void;
  /** demo: the designed flow on TEST data; live: an explanation, no money moves. */
  mode: 'demo' | 'live';
  availableMinor: number;
  /** "demo.priya@upi" / "Bank account ····4321". */
  destination: string;
  /** "Withdraw to UPI". */
  title: string;
  /** Demo only: the confirmed withdrawal (the page adds it to its demo history). */
  onConfirm: (breakdown: WithdrawalBreakdown) => void;
}

function rupeesInput(minor: number): string {
  return String(Math.floor(minor / 100));
}

export function WithdrawDialog({ open, onClose, mode, availableMinor, destination, title, onConfirm }: WithdrawDialogProps) {
  const [amount, setAmount] = useState(() => rupeesInput(availableMinor));
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<WithdrawalBreakdown | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const availableRef = useRef(availableMinor);
  availableRef.current = availableMinor;

  // Every opening starts from the full available balance (read at opening time only).
  useEffect(() => {
    if (open) {
      setAmount(rupeesInput(availableRef.current));
      setTouched(false);
      setDone(null);
    }
  }, [open]);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  if (mode === 'live') {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Payouts are paid in batches"
        actions={
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className={styles.copy}>
          There is no self-serve withdrawal yet, so nothing is sent from here. Afflino&rsquo;s finance team prepares
          payout batches from approved earnings the brand has paid for; a second person approves every batch before
          it goes out.
        </p>
        <p className={styles.copy}>
          Your available {formatINRFromMinor(availableMinor)} goes into the next batch when it is above your payout
          threshold, and reaches {destination} after TDS.
        </p>
      </Dialog>
    );
  }

  const check = validateWithdrawAmount(amount, availableMinor);
  const breakdown = check.ok && check.grossMinor !== undefined ? withdrawalBreakdown(check.grossMinor) : null;
  const showError = touched && !check.ok;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!breakdown) {
      amountRef.current?.focus();
      return;
    }
    setDone(breakdown);
    onConfirm(breakdown);
  };

  if (done) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Withdrawal requested"
        actions={
          <Button ref={doneRef} variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p className={styles.copy}>
          {formatINRFromMinor(done.netMinor)} goes to {destination} with the next payout run, after{' '}
          {tdsLabel(done.ratePct, done.section)} of {formatINRFromMinor(done.tdsMinor)}.
        </p>
        <p className={styles.demo}>Demo: nothing was sent and no money moved.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      initialFocusRef={amountRef}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" arrow type="submit" form="withdraw-form">
            Confirm withdrawal
          </Button>
        </>
      }
    >
      <form id="withdraw-form" className={styles.form} onSubmit={onSubmit} noValidate>
        <Field
          label="Amount (₹)"
          hint={`${formatINRFromMinor(MIN_WITHDRAWAL_RUPEES * 100)} minimum · up to ${formatINRFromMinor(availableMinor)}`}
          error={showError ? check.message : undefined}
        >
          <Input
            ref={amountRef}
            inputMode="numeric"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setTouched(true);
            }}
          />
        </Field>
        <dl className={styles.breakdown} aria-live="polite">
          <div className={styles.line}>
            <dt>Amount</dt>
            <dd>{breakdown ? formatINRFromMinor(breakdown.grossMinor) : '—'}</dd>
          </div>
          <div className={styles.line}>
            <dt>{tdsLabel()}</dt>
            <dd>{breakdown ? `−${formatINRFromMinor(breakdown.tdsMinor)}` : '—'}</dd>
          </div>
          <div className={styles.total}>
            <dt>You receive</dt>
            <dd>{breakdown ? formatINRFromMinor(breakdown.netMinor) : '—'}</dd>
          </div>
        </dl>
        <p className={styles.to}>To {destination}</p>
        <p className={styles.demo}>Demo: confirming sends nothing and moves no money.</p>
      </form>
    </Dialog>
  );
}
