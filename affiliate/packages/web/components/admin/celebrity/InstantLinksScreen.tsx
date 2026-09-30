'use client';

/*
 * Instant links (admin, no artboard): paste an amazon.in product link or its
 * ASIN, name it in your own words, choose the in-house pages, and get one
 * tracked afflino.com/r/ link per page (POST /v1/editorial/instant-links;
 * the Amazon rules: owner-operated pages with their own tracking ID only).
 * Always into an outfit piece of a look (SIMILAR by default; EXACT with its
 * evidence, pending a second person — its links wait for the approval): a
 * link printed in a look's post pauses with that look's takedown. The
 * tracked links go on those pages' posts only; a message or a comment reply
 * carries only the look's afflino.com page.
 */

import { useMemo, useState } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { Button, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { IdempotencyKeys } from '@/lib/idempotency';
import {
  linkablePages,
  looksLikeProductInput,
  tagProblems,
  type EditorialLook,
  type EditorialLookRow,
  type InstantLinksResult,
  type PropertyRow,
} from '@/lib/celebrity-admin';
import { DEMO_EDITORIAL_LOOK, DEMO_EDITORIAL_LOOKS, DEMO_PROPERTIES } from '@/lib/demo/celebrity';
import { InstantResult } from './LookEditor';
import { LiveBadge, LiveBanner } from './LiveStatus';
import { send, useLiveData } from './useLiveData';
import styles from './admin.module.css';

const keys = new IdempotencyKeys('instant-links');

export function InstantLinksScreen() {
  const props = useLiveData<{ items: PropertyRow[] }>('/v1/editorial/properties', DEMO_PROPERTIES, 'the in-house pages');
  const looks = useLiveData<{ items: EditorialLookRow[] }>('/v1/editorial/looks?page_size=100', DEMO_EDITORIAL_LOOKS, 'the looks');
  const [lookId, setLookId] = useState('');
  const look = useLiveData<EditorialLook | null>(lookId && !looks.demo ? `/v1/editorial/looks/${lookId}` : null, lookId ? DEMO_EDITORIAL_LOOK : null, 'the look');
  const pages = useMemo(() => linkablePages(props.value.items), [props.value.items]);
  const [f, setF] = useState({ input: '', brand: '', model: '', category: 'Clothing', piece: '', match_type: 'similar' as 'similar' | 'exact', evidence: '', evidence_source: '' });
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<InstantLinksResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pieces = lookId && look.value ? look.value.pieces : [];
  const [touched, setTouched] = useState(false);
  const problems = [...tagProblems({ ...f, input: f.input, brand: f.brand, model: f.model }), ...(f.piece ? [] : ['Choose the look and the piece the product goes into.'])];
  const ready = !props.demo && looksLikeProductInput(f.input) && f.category.trim() !== '' && problems.length === 0;

  async function submit() {
    setTouched(true);
    if (!ready) return;
    setBusy(true);
    setError(null);
    const body = {
      asin_or_url: f.input.trim(),
      brand: f.brand.trim(),
      model: f.model.trim(),
      category: f.category.trim(),
      property_ids: chosen,
      piece_id: f.piece,
      match_type: f.match_type,
      ...(f.match_type === 'exact' ? { evidence: f.evidence.trim(), evidence_source: f.evidence_source.trim(), evidence_captured_at: new Date().toISOString() } : {}),
    };
    const r = await send<InstantLinksResult>('/v1/editorial/instant-links', body, keys.keyFor(body));
    setBusy(false);
    if (r.ok) setResult(r.data);
    else setError(`${r.message} (${r.code})`);
  }

  return (
    <>
      <h1 className="sr-only">Admin: instant links</h1>
      <AdminSection title="Instant links" titleId="instant-title" badge={<LiveBadge demo={props.demo} cause={props.cause} />}>
        <LiveBanner notice={props.notice} />
        <PageNote>
          One amazon.in product → a tracked link for each chosen page (only pages that are yours and have their own tracking ID; Amazon links never
          go in a message, an email or anywhere offline). Name the product in your own words — never a celebrity&apos;s name. It goes into an outfit
          piece of a look, so a takedown of that look pauses its links too.
        </PageNote>
        <div className={styles.split}>
          <div className={styles.form}>
            <Field label="amazon.in link or ASIN" labelSuffix="(required)">
              <Input value={f.input} onChange={(e) => setF({ ...f, input: e.target.value })} onBlur={() => setTouched(true)} placeholder="Paste the product link or its ASIN" />
            </Field>
            <div className={styles.formRow}>
              <Field label="Brand" labelSuffix="(required)">
                <Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} onBlur={() => setTouched(true)} />
              </Field>
              <Field label="Product" labelSuffix="(required)">
                <Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} onBlur={() => setTouched(true)} />
              </Field>
              <Field label="Category">
                <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
              </Field>
            </div>
            <Field label="Pages" group hint={pages.length ? 'Each gets its own tracked link, with its own tracking ID.' : 'No page has its own tracking ID yet (deploy/linode/amazon.sh setup).'}>
              <div className={styles.formRow}>
                {pages.map((p) => (
                  <Checkbox key={p.id} checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))}>
                    {p.platform}: {p.account} <span className={styles.muted}>({p.amazon_tracking_id})</span>
                  </Checkbox>
                ))}
              </div>
            </Field>
            <div className={styles.formRow}>
              <Field label="Into a look" labelSuffix="(required)">
                <Select value={lookId} onChange={(e) => { setLookId(e.target.value); setF({ ...f, piece: '' }); }} placeholder="No look" options={looks.value.items.filter((l) => !l.takedown_id).map((l) => ({ value: l.id, label: `${l.celebrity.name} · ${l.title}` }))} />
              </Field>
              <Field label="Piece">
                <Select value={f.piece} disabled={!lookId} onChange={(e) => setF({ ...f, piece: e.target.value })} placeholder="Choose a piece" options={pieces.map((p, i) => ({ value: p.id, label: `${i + 1}. ${p.label}` }))} />
              </Field>
              <Field label="Match">
                <Select value={f.match_type} disabled={!f.piece} onChange={(e) => setF({ ...f, match_type: e.target.value as 'similar' | 'exact' })} options={[{ value: 'similar', label: 'SIMILAR (default)' }, { value: 'exact', label: 'EXACT (evidence)' }]} />
              </Field>
            </div>
            {f.match_type === 'exact' ? (
              <>
                <Field label="Evidence" labelSuffix="(required)">
                  <Textarea rows={2} value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
                </Field>
                <Field label="Evidence source" labelSuffix="(required)">
                  <Input value={f.evidence_source} onChange={(e) => setF({ ...f, evidence_source: e.target.value })} />
                </Field>
              </>
            ) : null}
            {touched && problems.length ? (
              <ul className={styles.problems} aria-live="polite">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            <div className={styles.actions}>
              <Button variant="primary" disabled={busy || props.demo} onClick={() => void submit()}>
                {busy ? 'Making links…' : 'Make the links'}
              </Button>
              {props.demo ? <span className={styles.muted}>Demo data: nothing is sent.</span> : null}
            </div>
            {error ? <p className={styles.error}>{error}</p> : null}
          </div>
          <div>
            <h2 className={styles.h4}>Result</h2>
            {result ? <InstantResult result={result} /> : <p className={styles.muted}>The links appear here, one per page, with the label to use in the post.</p>}
          </div>
        </div>
      </AdminSection>
    </>
  );
}
