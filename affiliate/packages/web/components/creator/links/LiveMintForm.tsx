'use client';

/*
 * Live minting — the restored LinkBuilder's POST /v1/links path, kept
 * reachable on 3c. The four ids (property, programme, offer, placement) are
 * chosen from TEST demo option lists (lib/portal-demo.ts; no listing
 * endpoint in v1). mintLiveLink() (lib/links.ts) does the call: a live
 * result is the URL the API composed; an unreachable API gives the
 * labelled, untracked redirect.demo.invalid link; guard errors show inline.
 * The result goes to the Generated box through onMinted().
 */

import { useId, useState, type FormEvent } from 'react';
import { Button, Field, Select } from '@/components/ui';
import type { CreateLinkBody } from '@/lib/api';
import { mintLiveLink, type MintResult } from '@/lib/links';
import { DEMO_OFFERS, DEMO_PLACEMENTS, DEMO_PROGRAMMES, DEMO_PROPERTIES, type DemoOption } from '@/lib/portal-demo';
import styles from './LiveMintForm.module.css';

const FIELDS: { key: keyof CreateLinkBody; label: string; options: DemoOption[] }[] = [
  { key: 'property_id', label: 'Property', options: DEMO_PROPERTIES },
  { key: 'programme_id', label: 'Programme', options: DEMO_PROGRAMMES },
  { key: 'offer_id', label: 'Offer', options: DEMO_OFFERS },
  { key: 'placement_id', label: 'Placement', options: DEMO_PLACEMENTS },
];

export type MintedLink = Extract<MintResult, { kind: 'live' | 'fallback' }>;

export interface LiveMintFormProps {
  onMinted: (result: MintedLink) => void;
  /** The last link minted on this page, if any (so clearing the box never loses it). */
  last?: MintedLink | null;
}

export function LiveMintForm({ onMinted, last }: LiveMintFormProps) {
  const formId = `mint${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<keyof CreateLinkBody, string>>({
    property_id: '',
    programme_id: '',
    offer_id: '',
    placement_id: '',
  });
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const allChosen = FIELDS.every((f) => values[f.key] !== '');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!allChosen || minting) return;
    setMinting(true);
    setError(null);
    setStatus('');
    const result = await mintLiveLink(values satisfies CreateLinkBody);
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
        through the API (POST /v1/links) for a property, programme, offer and placement: it returns a /r/{'{token}'} URL.
        The option lists are TEST demo data until listing endpoints exist.
      </p>
      <div>
        <Button arrow={!open} aria-expanded={open} aria-controls={formId} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide live minting' : 'Mint a live tracked link'}
        </Button>
      </div>

      <form id={formId} className={styles.form} hidden={!open} onSubmit={onSubmit}>
        <div className={styles.grid}>
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} required>
              <Select
                value={values[f.key]}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.key]: e.target.value }));
                  setError(null);
                }}
                placeholder={`Choose ${f.label.toLowerCase()}…`}
                options={f.options.map((o) => ({ value: o.id, label: o.label }))}
              />
            </Field>
          ))}
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" arrow disabled={!allChosen || minting}>
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
