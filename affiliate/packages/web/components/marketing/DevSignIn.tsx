'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { cx } from '../ui/cx';
import {
  browserStorage,
  checkDevToken,
  checkPublisherId,
  clearDevSession,
  decodeTokenClaims,
  formatExpiry,
  readDevSession,
  saveDevSession,
  tokenTail,
  type DevSession,
  type StorageLike,
} from './devSession';
import styles from './DevSignIn.module.css';

const TOKEN_ID = 'login-token';
const PUBLISHER_ID = 'login-publisher-id';

interface Errors {
  token?: string;
  publisherId?: string;
}

function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={cx(styles.factValue, mono && styles.mono)}>{children}</dd>
    </div>
  );
}

/**
 * /login — the dev sign-in. No identity provider exists yet, so this page
 * says so and stores a development token (the API's JWT stub) and an
 * optional publisher id under lib/api.ts's localStorage keys. It checks the
 * token's shape only; the API verifies the signature on every request.
 */
export function DevSignIn() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [storage, setStorage] = useState<StorageLike | null>(null);
  const [session, setSession] = useState<DevSession | null>(null);
  const [token, setToken] = useState('');
  const [publisherId, setPublisherId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState('');
  const [leaving, setLeaving] = useState(false);
  const tokenRef = useRef<HTMLInputElement>(null);
  const publisherRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const available = browserStorage();
    const current = available ? readDevSession(available) : null;
    setStorage(available);
    setSession(current);
    setPublisherId(current?.publisherId ?? '');
    setMounted(true);
  }, []);

  const claims = session ? decodeTokenClaims(session.token) : null;
  const expired = claims?.exp !== undefined && claims.exp * 1000 <= Date.now();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storage || leaving) return;
    const next: Errors = {};
    let tokenValue = session?.token ?? '';
    if (token.trim() !== '' || !session) {
      const checked = checkDevToken(token);
      if (checked.ok) tokenValue = checked.value!;
      else next.token = checked.message;
    } else if (expired) {
      next.token = 'The saved token has expired. Paste a new one.';
    }
    const publisher = checkPublisherId(publisherId);
    if (!publisher.ok) next.publisherId = publisher.message;
    setErrors(next);
    setStatus('');
    if (next.token) {
      tokenRef.current?.focus();
      return;
    }
    if (next.publisherId) {
      publisherRef.current?.focus();
      return;
    }
    saveDevSession(storage, { token: tokenValue, publisherId: publisher.value ?? '' });
    setSession(readDevSession(storage));
    setToken('');
    setShowToken(false);
    setLeaving(true);
    setStatus('Saved in this browser. Opening your dashboard…');
    router.push('/app');
  }

  function onSignOut() {
    if (!storage) return;
    clearDevSession(storage);
    setSession(null);
    setToken('');
    setPublisherId('');
    setErrors({});
    setShowToken(false);
    setStatus('Signed out. The token and publisher id were removed from this browser.');
    tokenRef.current?.focus();
  }

  const blocked = mounted && !storage;

  return (
    <div className={styles.page}>
      <section className={styles.main} aria-labelledby="login-title">
        <Eyebrow tone="accent" tracking="wide">
          Dev sign-in
        </Eyebrow>
        <h1 id="login-title" className={styles.title}>
          Log in
        </h1>
        <p className={styles.lead}>
          There is no sign-in yet. Until an identity provider is chosen, the API trusts a signed development
          token. Paste one here to use the app against the API from this browser.
        </p>

        {blocked ? (
          <Banner title="This browser blocks local storage.">
            A token cannot be saved here. Allow site data for this address, or use another browser profile.
          </Banner>
        ) : null}

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <Field
            id={TOKEN_ID}
            label="API token"
            hint="Developers mint one with scripts/mint-dev-token.mjs in the API package."
            error={errors.token}
            required={!session}
          >
            <div className={styles.tokenRow}>
              <Input
                ref={tokenRef}
                mono
                type={showToken ? 'text' : 'password'}
                name="token"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={session ? `Saved (…${tokenTail(session.token)}). Paste a new one to replace it.` : 'eyJhbGciOi…'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button
                variant="secondary"
                className={styles.reveal}
                aria-controls={TOKEN_ID}
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? 'Hide' : 'Show'}
                <span className="sr-only"> token</span>
              </Button>
            </div>
          </Field>

          <Field
            id={PUBLISHER_ID}
            label="Publisher id"
            labelSuffix="(optional)"
            hint="The uuid of your publisher account; the earnings views read it. Leave it empty to keep the TEST demo publisher."
            error={errors.publisherId}
          >
            <Input
              ref={publisherRef}
              mono
              name="publisherId"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={publisherId}
              onChange={(e) => setPublisherId(e.target.value)}
            />
          </Field>

          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              arrow
              className={styles.action}
              disabled={!mounted || blocked || leaving}
            >
              Continue to your dashboard
            </Button>
            {session ? (
              <Button variant="secondary" className={styles.action} onClick={onSignOut} disabled={leaving}>
                Sign out
              </Button>
            ) : null}
          </div>
          <p className={styles.status} role="status" aria-live="polite">
            {status}
          </p>
        </form>

        <p className={styles.meta}>
          New to Afflino? <Link href="/join">Join the network</Link>
        </p>
      </section>

      <aside className={styles.side} aria-labelledby="session-title">
        <Eyebrow as="h2" id="session-title" tracking="wide">
          This browser
        </Eyebrow>
        <dl className={styles.facts}>
          <Fact label="Status">
            {!mounted ? (
              <Skeleton height={22} width="60%" />
            ) : session ? (
              <span className={styles.statusValue}>Development token saved</span>
            ) : (
              <span className={styles.statusValue}>No token saved</span>
            )}
          </Fact>
          {session ? (
            <>
              <Fact label="Role">{claims?.role ?? 'Not stated in the token'}</Fact>
              <Fact label="Organisation" mono={Boolean(claims?.org_id)}>
                {claims?.org_id ?? 'Not stated in the token'}
              </Fact>
              <Fact label="Expires">
                {claims?.exp !== undefined ? (
                  <>
                    {formatExpiry(claims.exp)}
                    {expired ? <span className={styles.expired}> · expired</span> : null}
                  </>
                ) : (
                  'No expiry stated'
                )}
              </Fact>
            </>
          ) : null}
          <Fact label="Publisher id" mono={Boolean(session?.publisherId)}>
            {!mounted ? <Skeleton height={16} width="80%" /> : (session?.publisherId ?? 'Not set')}
          </Fact>
        </dl>
        <div className={styles.notes}>
          {session ? (
            <p>
              Role, organisation and expiry are read from the token as it states them. This page verifies
              nothing; the API checks the signature on every request.
            </p>
          ) : (
            <p>Without a token the app shows TEST demo data.</p>
          )}
          <p>
            The token stays in this browser&apos;s local storage until you sign out. Anyone using this browser
            profile can read it.
          </p>
        </div>
      </aside>
    </div>
  );
}
