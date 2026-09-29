'use client';

/*
 * Tracked-link minting — the live function that was /portal/links. The 3c
 * screen (link generator + "My links" table) is built on top of this; until
 * then the page keeps the HEAD logic unchanged: POST /v1/links with the four
 * ids, the API composes the URL (REDIRECT_BASE_URL + /r/ + token), guard
 * errors map through linkErrorMessage(), and an unreachable API (also behind
 * the /api proxy, which answers 502 UPSTREAM_UNAVAILABLE) yields a clearly
 * labelled, untracked demo URL on an RFC 2606 .invalid host. The
 * option lists are TEST demo data (no listing endpoint in v1).
 */

import { useEffect, useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { PageBody, PageNote } from '@/components/shell/PageBody';
import { Button, Field, PageHeader, Select } from '@/components/ui';
import { ApiError, apiFetch, linkErrorMessage, type CreateLinkBody, type CreateLinkResponse } from '@/lib/api';
import { DEMO_OFFERS, DEMO_PLACEMENTS, DEMO_PROGRAMMES, DEMO_PROPERTIES, type DemoOption } from '@/lib/portal-demo';
import { CREATOR_DISCLOSURE_LINE } from '@/lib/site-copy';
import styles from './page.module.css';

const FIELDS: { key: keyof CreateLinkBody; label: string; options: DemoOption[] }[] = [
  { key: 'property_id', label: 'Property', options: DEMO_PROPERTIES },
  { key: 'programme_id', label: 'Programme', options: DEMO_PROGRAMMES },
  { key: 'offer_id', label: 'Offer', options: DEMO_OFFERS },
  { key: 'placement_id', label: 'Placement', options: DEMO_PLACEMENTS },
];

type Copied = 'link' | 'disclosure' | null;

export function LinkBuilder() {
  const [values, setValues] = useState<Record<keyof CreateLinkBody, string>>({
    property_id: '',
    programme_id: '',
    offer_id: '',
    placement_id: '',
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; demo: boolean } | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const allChosen = FIELDS.every((f) => values[f.key] !== '');

  function setField(key: keyof CreateLinkBody, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
    setResult(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allChosen || creating) return;
    setCreating(true);
    setError(null);
    setResult(null);
    setCopied(null);
    try {
      const data = await apiFetch<CreateLinkResponse>('/v1/links', {
        method: 'POST',
        body: values satisfies CreateLinkBody,
      });
      // The API composes the tracked URL (REDIRECT_BASE_URL + /r/ + token); never rebuild it here.
      setResult({ url: data.url, demo: false });
    } catch (err) {
      if (err instanceof ApiError) {
        // Unreachable: the browser could not reach the API (NETWORK_UNREACHABLE), or the
        // same-origin /api proxy could not (502 UPSTREAM_UNAVAILABLE, app/api/[...path]).
        if (err.code === 'NETWORK_UNREACHABLE' || err.code === 'UPSTREAM_UNAVAILABLE') {
          // Demo mint: clearly labelled, NOT a tracked link (RFC 2606 .invalid host).
          const token = `demo-${Math.random().toString(36).slice(2, 10)}`;
          setResult({ url: `https://redirect.demo.invalid/r/${token}`, demo: true });
        } else {
          setError(linkErrorMessage(err.code));
        }
      } else {
        setError('Link creation failed — unexpected error.');
      }
    } finally {
      setCreating(false);
    }
  }

  async function copy(text: string, what: Exclude<Copied, null>) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard unavailable (non-secure context): the user can select the text manually.
      setCopied(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="My links"
        title="New tracked link"
        description="Mint a tracked redirect link for a property + programme + offer + placement."
        actions={<DemoBadge variant="mock" className={styles.badge} />}
      />
      <PageBody>
        <PageNote>
          The option lists below are TEST demo data — no programme or property listing endpoint exists in the v1
          surface yet. Submitting calls POST /v1/links against your API when it is reachable.
        </PageNote>

        <form onSubmit={onSubmit} className={styles.form}>
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} required>
              <Select
                value={values[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={`Choose ${f.label.toLowerCase()}…`}
                options={f.options.map((o) => ({ value: o.id, label: o.label }))}
              />
            </Field>
          ))}

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <div>
            <Button type="submit" variant="primary" arrow disabled={!allChosen || creating}>
              {creating ? 'Creating…' : 'Create tracked link'}
            </Button>
          </div>
        </form>

        {result && (
          <section className={styles.result} aria-label="Generated link">
            <p className={styles.resultTitle}>Your link is ready</p>
            {result.demo && (
              <>
                <DemoBadge variant="fallback" className={styles.badge} />
                <p className={styles.demoNote}>
                  Demo link — generated locally because the API is unreachable. It is not tracked and will not
                  earn commission.
                </p>
              </>
            )}
            <code className={styles.url}>{result.url}</code>
            <div className={styles.resultActions}>
              <Button variant="primary" size="sm" onClick={() => copy(result.url, 'link')}>
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </Button>
              <Button size="sm" onClick={() => copy(CREATOR_DISCLOSURE_LINE, 'disclosure')}>
                {copied === 'disclosure' ? 'Copied' : 'Disclosure text'}
              </Button>
            </div>
            <p className={styles.disclosureNote}>
              Disclosure text copies “{CREATOR_DISCLOSURE_LINE}” — draft wording, pending counsel sign-off.
            </p>
          </section>
        )}
      </PageBody>
    </>
  );
}
