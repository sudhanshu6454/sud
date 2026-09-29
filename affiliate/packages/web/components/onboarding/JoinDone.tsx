'use client';

import { useEffect, useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, Eyebrow } from '@/components/ui';
import { COPIED_MS, copyText } from '@/lib/clipboard';
import { dashboardHref, onboardingStateLabel, type PublisherApplication, type Role } from '@/lib/onboarding';
import styles from './Onboarding.module.css';

export type FinishResult =
  /** POST /v1/publishers answered 201: a real application exists. */
  | { kind: 'live'; publisher: PublisherApplication }
  /** No live call was made: signed out, or a brand / agency (no endpoint). */
  | { kind: 'demo'; reason: 'signed-out' | 'business' }
  /** The API could not be reached: nothing was created. */
  | { kind: 'fallback' };

interface JoinDoneProps {
  role: Role | null;
  result: FinishResult;
  /** Re-run the submission (fallback only). */
  onRetry: () => void;
  retrying: boolean;
  headingRef: React.Ref<HTMLHeadingElement>;
  announce: (message: string) => void;
}

/** The success panel after "Finish setup →": what happened (live, demo or unreachable) and the next step. */
export function JoinDone({ role, result, onRetry, retrying, headingRef, announce }: JoinDoneProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copyId(id: string) {
    if (await copyText(id)) {
      setCopied(true);
      announce('Copied');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } else {
      setCopied(false); // clipboard unavailable: the id stays selectable
    }
  }

  const title = result.kind === 'live' ? 'Application received.' : 'You’re set up — as a demo.';
  const lead =
    result.kind === 'live'
      ? 'Your publisher application is open. Until the network team has reviewed it, you can browse offers but cannot create tracked links.'
      : result.kind === 'fallback'
        ? 'The API could not be reached, so no application was created and nothing was saved. Try again when it is up.'
        : result.reason === 'business'
          ? `Nothing was created: there is no ${role === 'agency' ? 'agency' : 'brand'} sign-up endpoint yet, and no payment was taken. The dashboard shows TEST demo data.`
          : 'Nothing was created: you are not signed in, so this sign-up was a demo. Log in with a dev token and run the sign-up again to open a real publisher application.';

  return (
    <div className={styles.done}>
      <div>
        <div className={styles.eyebrowRow}>
          <Eyebrow tone="accent" tracking="wide">
            Setup complete
          </Eyebrow>
          {result.kind === 'fallback' ? (
            <DemoBadge variant="fallback" className={styles.badge} />
          ) : result.kind === 'demo' ? (
            <DemoBadge variant="mock" className={styles.badge} />
          ) : null}
        </div>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        <p className={styles.lead}>{lead}</p>
      </div>

      {result.kind === 'live' ? (
        <>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>Publisher id</dt>
              <dd>
                <code className={styles.mono}>{result.publisher.id}</code>
                <Button size="xs" onClick={() => copyId(result.publisher.id)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>Onboarding state</dt>
              <dd>
                {onboardingStateLabel(result.publisher.onboarding_state)}{' '}
                <span className={styles.meta}>({result.publisher.onboarding_state})</span>
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>Legal name</dt>
              <dd>{result.publisher.legal_name}</dd>
            </div>
          </dl>
          <p className={styles.meta}>
            Saved as this browser’s publisher id for the app. Platform connections, PAN and payout details were a demo
            and were not sent.
          </p>
        </>
      ) : result.kind === 'fallback' ? (
        <div>
          <Button onClick={onRetry} disabled={retrying}>
            {retrying ? 'Trying again…' : 'Try again'}
          </Button>
        </div>
      ) : null}

      <div className={styles.footer}>
        {result.kind === 'demo' && result.reason === 'signed-out' ? (
          <Button variant="ghost" href="/login" className={styles.touch}>
            Log in
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" href={dashboardHref(role)} arrow className={styles.cta}>
          Go to your dashboard
        </Button>
      </div>
    </div>
  );
}
