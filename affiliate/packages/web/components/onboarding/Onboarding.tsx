'use client';

/*
 * /join — sign-up & onboarding in three steps (design handover 2a, 3a; the
 * brand / agency branch is not drawn and uses the same shell).
 *
 * State: one reducer (lib/onboarding.ts) holds every field of both
 * branches, so Back — the button or the browser's — never loses input.
 * The step lives in the URL (?role=…&step=2|3|done, pushed with
 * history.pushState, which Next 14.2 syncs into useSearchParams); a step
 * whose earlier steps are incomplete is clamped back (reachableView).
 * Nothing is persisted: a reload starts over at step 1 (no PII in storage).
 *
 * Demo flows (no SMS, OAuth, KYC or payments provider exists) are labelled
 * where they happen. The one live call is POST /v1/publishers for a creator
 * or publisher holding a dev token (lib/api.ts); an unreachable API gives a
 * labelled demo result (<DemoBadge variant="fallback" />), any other
 * failure a top banner and nothing created.
 */

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Banner, Button, Eyebrow, Lockup, cx } from '@/components/ui';
import { ApiError, PUBLISHER_ID_KEY, apiFetch, getToken } from '@/lib/api';
import {
  applicationBody,
  branchOf,
  firstErrorKey,
  initialRole,
  initialState,
  joinSearch,
  onboardingReducer,
  parsePlan,
  parseRole,
  parseStep,
  planFor,
  planSummary,
  reachableView,
  stepErrors,
  stepIndexLabel,
  stepsFor,
  submitFailure,
  submitsLive,
  visibleErrors,
  type JoinView,
  type PublisherApplication,
  type StepNumber,
} from '@/lib/onboarding';
import { focusField, type StepProps } from './fields';
import { JoinDone, type FinishResult } from './JoinDone';
import { StepAccount } from './StepAccount';
import { StepBilling, StepCompany } from './StepBusiness';
import { StepPayout } from './StepPayout';
import { StepPlatforms } from './StepPlatforms';
import styles from './Onboarding.module.css';

interface StepCopy {
  title: string;
  lead?: string;
}

function stepCopy(step: StepNumber, role: ReturnType<typeof parseRole>): StepCopy {
  if (step === 1) return { title: 'How will you use Afflino?' };
  if (branchOf(role) === 'business') {
    if (step === 2) {
      return role === 'agency'
        ? {
            title: 'Tell us about your agency',
            lead: 'These details go on your invoices. Each brand client adds its own later.',
          }
        : {
            title: 'Tell us about the company',
            lead: 'These details go on your invoices. Offer landing pages must be on this website.',
          };
    }
    return {
      title: 'Billing and wallet',
      lead: 'Who receives invoices, and what goes into the wallet that pays creators.',
    };
  }
  if (step === 2) {
    return {
      title: 'Connect where your audience is',
      lead: 'We read follower count and audience location only. Brands see this when you apply to their offer.',
    };
  }
  return { title: 'Where should we pay you?' };
}

/**
 * On the footer buttons: pressing them must not blur the field first. A blur
 * shows that field's error, which on a phone pushes the button down between
 * press and release, and the tap would miss. Continue validates everything
 * anyway; keyboard activation is unaffected.
 */
function keepFocus(e: MouseEvent<HTMLElement>) {
  e.preventDefault();
}

/** Random key for Idempotency-Key (crypto.randomUUID needs a secure context; getRandomValues does not). */
function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function Onboarding() {
  const searchParams = useSearchParams();
  const requested = parseStep(searchParams.get('step'));
  // The home page's "Start free" arrives as ?role=brand&plan=starter: the plan
  // preselects the brand flow, is shown on its steps and stays in the URL.
  const [plan] = useState(() => parsePlan(searchParams.get('plan')));
  const [state, dispatch] = useReducer(
    onboardingReducer,
    initialRole(searchParams.get('role'), searchParams.get('plan')),
    initialState,
  );
  const { form } = state;
  const [result, setResult] = useState<FinishResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastView = useRef<JoinView | null>(null);
  // One key per legal name: a double click or a retry replays the same application instead of opening two.
  const idempotencyKeys = useRef(new Map<string, string>());

  const view = reachableView(form, requested, result !== null);
  const steps = stepsFor(form.role);
  const live = submitsLive(form.role, hasToken);

  // localStorage is client-only: read the dev token after hydration.
  useEffect(() => {
    setHasToken(Boolean(getToken()));
  }, []);

  // The URL follows what is shown: a clamped step (fresh load of ?step=3, a hand-edited URL)
  // and a changed role are written back in place, so a reload keeps the role.
  const urlRole = parseRole(searchParams.get('role'));
  const urlPlan = parsePlan(searchParams.get('plan'));
  const shownPlan = planFor(form.role, plan);
  useEffect(() => {
    if (view !== requested || form.role !== urlRole || shownPlan !== urlPlan) {
      window.history.replaceState(null, '', `/join${joinSearch(form.role, view, plan)}`);
    }
  }, [view, requested, form.role, urlRole, shownPlan, urlPlan, plan]);

  // Moving between steps puts focus on the new step's heading (not on first load).
  useEffect(() => {
    if (lastView.current !== null && lastView.current !== view) {
      headingRef.current?.focus();
      window.scrollTo({ top: 0 });
    }
    lastView.current = view;
  }, [view]);

  const announce = useCallback((message: string) => {
    // Clear first so repeating the same message is announced again.
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 50);
  }, []);

  // State null: Next's patched pushState copies its own entry state; passing history.state
  // (which carries Next's __NA flag) would make it skip syncing useSearchParams.
  function go(next: JoinView) {
    window.history.pushState(null, '', `/join${joinSearch(form.role, next, plan)}`);
  }

  function blockedBy(step: StepNumber): boolean {
    dispatch({ type: 'attempt', step });
    const first = firstErrorKey(stepErrors(form, step));
    if (first) {
      // The errors render on this dispatch; focus the first invalid control once they have.
      window.requestAnimationFrame(() => focusField(first));
      return true;
    }
    return false;
  }

  async function submit() {
    if (!submitsLive(form.role, Boolean(getToken()))) {
      setResult({ kind: 'demo', reason: branchOf(form.role) === 'business' ? 'business' : 'signed-out' });
      go('done');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const body = applicationBody(form);
    let key = idempotencyKeys.current.get(body.legal_name);
    if (!key) {
      key = `join-${randomKey()}`;
      idempotencyKeys.current.set(body.legal_name, key);
    }
    try {
      const publisher = await apiFetch<PublisherApplication>('/v1/publishers', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': key },
      });
      try {
        window.localStorage.setItem(PUBLISHER_ID_KEY, publisher.id);
      } catch {
        // storage blocked: the id is still shown on the panel
      }
      setResult({ kind: 'live', publisher });
      if (view !== 'done') go('done');
    } catch (err) {
      const failure =
        err instanceof ApiError
          ? submitFailure(err.code, err.message)
          : ({ kind: 'error', message: 'Something went wrong. Nothing was saved; try again.' } as const);
      if (failure.kind === 'fallback') {
        setResult({ kind: 'fallback' });
        if (view !== 'done') go('done');
      } else {
        setResult(null);
        setSubmitError(failure.message);
        if (view === 'done') go(3);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (view === 'done' || submitting) return;
    if (blockedBy(view)) return;
    if (view < 3) go((view + 1) as StepNumber);
    else void submit();
  }

  function back() {
    if (view === 'done' || view === 1) return;
    go((view - 1) as StepNumber);
  }

  const stepProps: StepProps = {
    state,
    errors: view === 'done' ? {} : visibleErrors(state, view),
    dispatch,
    announce,
  };
  const business = branchOf(form.role) === 'business';
  const copy = view === 'done' ? null : stepCopy(view, form.role);
  // Supply steps 2 and 3 show TEST demo accounts / the demo PAN holder.
  const showsDemoData = view !== 'done' && view > 1 && !business;

  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <div className={styles.panelCell}>
        <header className={styles.panel}>
          <Link href="/" className={styles.home} aria-label="afflino — home">
            <Lockup markSize={28} variant="glyph" />
          </Link>
          <p className={styles.headline}>Set up in three steps.</p>
          <ol className={styles.steps} aria-label="Set-up steps">
            {steps.map((s) => {
              const current = view === s.number;
              const done = view === 'done' || s.number < view;
              return (
                <li
                  key={s.number}
                  className={cx(styles.step, current && styles.current)}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className={styles.stepFull}>
                    {stepIndexLabel(s.number)} — {s.label}
                  </span>
                  <span className={styles.stepShort} aria-hidden="true">
                    <span className={styles.stepNum}>{stepIndexLabel(s.number)}</span> {s.short}
                  </span>
                  {done ? <span className="sr-only"> (done)</span> : null}
                </li>
              );
            })}
          </ol>
        </header>
      </div>

      <main id="main" className={styles.main}>
        {submitError && view === 3 ? (
          // Title in the message run: Banner's own title span shrinks and wraps beside a long message.
          <Banner className={styles.banner}>
            <strong className={styles.bannerTitle}>Not submitted.</strong> {submitError}
          </Banner>
        ) : null}

        {view === 'done' && result ? (
          <JoinDone
            role={form.role}
            plan={shownPlan}
            result={result}
            onRetry={() => void submit()}
            retrying={submitting}
            headingRef={headingRef}
            announce={announce}
          />
        ) : copy ? (
          <form
            noValidate
            onSubmit={onSubmit}
            className={cx(styles.form, styles[`gap${view}`])}
            aria-labelledby="join-title"
          >
            <div>
              <div className={styles.eyebrowRow}>
                <Eyebrow tone="accent" tracking="wide">
                  Step {view} of 3
                </Eyebrow>
                {showsDemoData ? <DemoBadge variant="mock" className={styles.badge} /> : null}
              </div>
              <h1
                id="join-title"
                ref={headingRef}
                tabIndex={-1}
                className={cx(styles.title, view !== 1 && styles.titleSm)}
              >
                {copy.title}
              </h1>
              {copy.lead ? <p className={styles.lead}>{copy.lead}</p> : null}
              {shownPlan ? (
                <p className={styles.plan}>
                  <span className={styles.planLabel}>Plan</span> {planSummary(shownPlan)}, picked on the pricing
                  page.{' '}
                  <Link href="/#pricing" className={styles.inlineLink}>
                    Compare plans
                  </Link>
                </p>
              ) : null}
            </div>

            {view === 1 ? <StepAccount {...stepProps} /> : null}
            {view === 2 && !business ? <StepPlatforms {...stepProps} /> : null}
            {view === 3 && !business ? <StepPayout {...stepProps} /> : null}
            {view === 2 && business ? <StepCompany {...stepProps} /> : null}
            {view === 3 && business ? <StepBilling {...stepProps} /> : null}

            {view === 3 ? (
              <p className={styles.submitNote}>
                {live
                  ? 'Finishing opens a publisher application with your sign-in token.'
                  : business
                    ? 'Finishing is a demo: nothing is created and no payment is taken.'
                    : 'You are not signed in, so finishing is a demo and creates nothing.'}
              </p>
            ) : null}

            <div className={cx(styles.footer, view === 1 && styles.footerAccount)}>
              {view === 1 ? (
                <span className={styles.login}>
                  Already on Afflino? <Link href="/login">Log in</Link>
                </span>
              ) : (
                <Button variant="ghost" arrow="left" onClick={back} onMouseDown={keepFocus} className={styles.touch}>
                  Back
                </Button>
              )}
              <Button
                type="submit"
                variant="primary"
                arrow={!submitting}
                className={styles.cta}
                disabled={submitting}
                onMouseDown={keepFocus}
              >
                {view === 3 ? (submitting ? 'Finishing…' : 'Finish setup') : 'Continue'}
              </Button>
            </div>
          </form>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </main>
    </div>
  );
}
