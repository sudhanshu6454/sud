'use client';

import { useState } from 'react';
import Link from 'next/link';
import DemoBadge from '../../../components/DemoBadge';
import {
  API_BASE,
  ApiError,
  apiFetch,
  linkErrorMessage,
  type CreateLinkBody,
  type CreateLinkResponse,
} from '../../../lib/api';
import {
  DEMO_OFFERS,
  DEMO_PLACEMENTS,
  DEMO_PROGRAMMES,
  DEMO_PROPERTIES,
  type DemoOption,
} from '../../../lib/portal-demo';
import styles from './page.module.css';

const FIELDS: { key: keyof CreateLinkBody; label: string; options: DemoOption[] }[] = [
  { key: 'property_id', label: 'Property', options: DEMO_PROPERTIES },
  { key: 'programme_id', label: 'Programme', options: DEMO_PROGRAMMES },
  { key: 'offer_id', label: 'Offer', options: DEMO_OFFERS },
  { key: 'placement_id', label: 'Placement', options: DEMO_PLACEMENTS },
];

export default function LinkBuilderPage() {
  const [values, setValues] = useState<Record<keyof CreateLinkBody, string>>({
    property_id: '',
    programme_id: '',
    offer_id: '',
    placement_id: '',
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; demo: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

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
    setCopied(false);
    try {
      const data = await apiFetch<CreateLinkResponse>('/v1/links', {
        method: 'POST',
        body: values satisfies CreateLinkBody,
      });
      setResult({ url: data.url || `${API_BASE}/r/${data.token}`, demo: false });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'NETWORK_UNREACHABLE') {
          // Demo mint: clearly labelled, NOT a tracked link.
          const token = `demo-${Math.random().toString(36).slice(2, 10)}`;
          setResult({ url: `${API_BASE}/r/${token}`, demo: true });
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

  async function copyUrl() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
    } catch {
      // clipboard unavailable (non-secure context): user can select manually.
      setCopied(false);
    }
  }

  return (
    <div>
      <h1 className={styles.heading}>Link builder</h1>
      <p className={styles.sub}>
        Mint a tracked redirect link for a property + programme + offer + placement.
      </p>
      <DemoBadge variant="mock" />
      <p className={styles.hint}>
        The option lists below are demo data — no programme/property listing endpoint
        exists in the v1 surface yet. Submitting calls POST /v1/links against your
        real API when it is reachable.
      </p>

      <form onSubmit={onSubmit} className={styles.form}>
        {FIELDS.map((f) => (
          <label key={f.key} className={styles.field}>
            <span className={styles.fieldLabel}>{f.label}</span>
            <select
              value={values[f.key]}
              onChange={(e) => setField(f.key, e.target.value)}
              className={styles.select}
              required
            >
              <option value="">Choose {f.label.toLowerCase()}…</option>
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className={styles.submit}
          disabled={!allChosen || creating}
        >
          {creating ? 'Creating…' : 'Create tracked link'}
        </button>
      </form>

      {result && (
        <div className={styles.result}>
          <p className={styles.resultTitle}>Your link is ready</p>
          {result.demo && <DemoBadge variant="fallback" />}
          {result.demo && (
            <p className={styles.demoNote}>
              Demo link — generated locally because the API is unreachable. It is not
              tracked and will not earn commission.
            </p>
          )}
          <code className={styles.url}>{result.url}</code>
          <button type="button" className={styles.copyButton} onClick={copyUrl}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
        </div>
      )}

      <p className={styles.back}>
        <Link href="/portal">← Back to dashboard</Link>
      </p>
    </div>
  );
}
