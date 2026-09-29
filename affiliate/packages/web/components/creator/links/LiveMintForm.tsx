'use client';

/*
 * Live minting — the restored LinkBuilder's POST /v1/links path, kept
 * reachable on 3c. There is no listing endpoint for properties, programmes,
 * offers or placements, so the four ids are typed or pasted as uuids
 * (checked for shape, remembered in this browser for next time); the TEST
 * demo ids (lib/portal-demo.ts) are only offered as suggestions. A real
 * account uses its own ids (e.g. from db/seed-network.ts or the API).
 * mintLiveLink() (lib/links.ts) does the call, with one Idempotency-Key per
 * unchanged set of ids: a live result is the URL the API composed; an
 * unreachable API gives the labelled, untracked redirect.demo.invalid link;
 * guard errors show inline. The result goes to the Generated box through
 * onMinted().
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@/components/ui';
import type { CreateLinkBody } from '@/lib/api';
import { IdempotencyKeys } from '@/lib/idempotency';
import { LIVE_MINT_IDS_KEY, mintLiveLink, validateUuid, type MintResult } from '@/lib/links';
import { DEMO_OFFERS, DEMO_PLACEMENTS, DEMO_PROGRAMMES, DEMO_PROPERTIES, type DemoOption } from '@/lib/portal-demo';
import styles from './LiveMintForm.module.css';

type Ids = Record<keyof CreateLinkBody, string>;

const FIELDS: { key: keyof CreateLinkBody; label: string; what: string; suggestions: DemoOption[] }[] = [
  { key: 'property_id', label: 'Property id', what: 'property id', suggestions: DEMO_PROPERTIES },
  { key: 'programme_id', label: 'Programme id', what: 'programme id', suggestions: DEMO_PROGRAMMES },
  { key: 'offer_id', label: 'Offer id', what: 'offer id', suggestions: DEMO_OFFERS },
  { key: 'placement_id', label: 'Placement id', what: 'placement id', suggestions: DEMO_PLACEMENTS },
];

const EMPTY: Ids = { property_id: '', programme_id: '', offer_id: '', placement_id: '' };

function readSaved(): Ids {
  try {
    const raw = window.localStorage.getItem(LIVE_MINT_IDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY;
    const out = { ...EMPTY };
    for (const f of FIELDS) {
      const v = (parsed as Record<string, unknown>)[f.key];
      if (typeof v === 'string') out[f.key] = v;
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function save(ids: Ids): void {
  try {
    window.localStorage.setItem(LIVE_MINT_IDS_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked: the ids are simply not remembered
  }
}

export type MintedLink = Extract<MintResult, { kind: 'live' | 'fallback' }>;

export interface LiveMintFormProps {
  onMinted: (result: MintedLink) => void;
  /** The last link minted on this page, if any (so clearing the box never loses it). */
  last?: MintedLink | null;
}

export function LiveMintForm({ onMinted, last }: LiveMintFormProps) {
  const formId = `mint${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Ids>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const keys = useRef(new IdempotencyKeys('link'));

  // The last ids used in this browser (client-only storage, read after hydration).
  useEffect(() => {
    setValues(readSaved());
  }, []);

  const checks = FIELDS.map((f) => ({ field: f, result: validateUuid(values[f.key], f.what) }));
  const firstInvalid = checks.find((c) => !c.result.ok);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (minting) return;
    if (firstInvalid) {
      document.getElementById(`${formId}-${firstInvalid.field.key}`)?.focus();
      return;
    }
    const body = Object.fromEntries(checks.map((c) => [c.field.key, c.result.value ?? ''])) as unknown as CreateLinkBody;
    setMinting(true);
    setError(null);
    setStatus('');
    save(body as Ids);
    const result = await mintLiveLink(body, { idempotencyKey: keys.current.keyFor(body) });
    setMinting(false);
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    setStatus(
      result.kind === 'live'
        ? 'Live tracked link minted. It is in the Generated box.'
        : 'The API is unreachable: an untracked demo link is in the Generated box.',
    );
    onMinted(result);
  }

  return (
    <section className={styles.live} aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className={styles.title}>
        Live tracked link
      </h2>
      <p className={styles.copy}>
        The generator above makes demo links in the design’s format; they are not tracked. Mint a real tracked link
        through the API (POST /v1/links) for a property, programme, offer and placement of your organisation: it
        returns a /r/{'{token}'} URL. Paste their ids (uuids); there is no list to pick from yet. The suggested ids are
        TEST demo data, which a real API does not know.
      </p>
      <div>
        <Button arrow={!open} aria-expanded={open} aria-controls={formId} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide live minting' : 'Mint a live tracked link'}
        </Button>
      </div>

      <form id={formId} className={styles.form} hidden={!open} onSubmit={onSubmit} noValidate>
        <div className={styles.grid}>
          {checks.map(({ field: f, result }) => (
            <Field
              key={f.key}
              id={`${formId}-${f.key}`}
              label={f.label}
              required
              error={touched && !result.ok ? result.message : undefined}
            >
              <Input
                mono
                value={values[f.key]}
                list={`${formId}-${f.key}-suggestions`}
                autoComplete="off"
                spellCheck={false}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                onChange={(e) => {
                  const value = e.target.value;
                  setValues((v) => ({ ...v, [f.key]: value }));
                  setError(null);
                }}
              />
            </Field>
          ))}
        </div>
        {FIELDS.map((f) => (
          <datalist key={f.key} id={`${formId}-${f.key}-suggestions`}>
            {f.suggestions.map((o) => (
              <option key={o.id} value={o.id} label={`${o.label} (TEST demo id)`} />
            ))}
          </datalist>
        ))}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" arrow disabled={minting}>
            {minting ? 'Minting…' : 'Mint tracked link'}
          </Button>
        </div>
      </form>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      {last ? (
        <p className={styles.last}>
          Last minted{last.kind === 'fallback' ? ' (untracked, API unreachable)' : ''}:{' '}
          <code className={styles.code}>{last.url}</code>
        </p>
      ) : null}
    </section>
  );
}
