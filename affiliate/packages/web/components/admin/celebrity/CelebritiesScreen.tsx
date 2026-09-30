'use client';

/*
 * Celebrities and their rights (admin, no artboard). Live: GET
 * /v1/celebrities (with the capability matrix), GET /v1/celebrities/:id (the
 * review history, append-only, and their looks), POST /v1/celebrities
 * (always created unreviewed), POST /v1/celebrities/:id/rights-review.
 * Only the rights reviewer (counsel's role) sets Editorial or Cleared, with
 * the evidence reference; any editor may set Blocked. The screen asks for a
 * note on every change and shows what each status allows. Signed out: TEST
 * demo celebrities, nothing is sent.
 */

import { useEffect, useMemo, useState } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { Banner, Button, Checkbox, Field, Input, Select, Tag, Textarea } from '@/components/ui';
import { DEMO_CELEBRITIES, demoCelebrityDetail } from '@/lib/demo/celebrity';
import { IdempotencyKeys } from '@/lib/idempotency';
import {
  DEFAULT_MATRIX,
  RIGHTS_STATUSES,
  allowsText,
  displayLabel,
  reviewBody,
  reviewProblems,
  statusLabel,
  statusTone,
  type CelebrityDetail,
  type CelebrityList,
  type DisplayLevel,
  type ReviewDraft,
  type RightsStatus,
} from '@/lib/celebrity-admin';
import { formatDayMonthTime } from '@/lib/format';
import { LiveBadge, LiveBanner } from './LiveStatus';
import { send, tokenRole, useLiveData } from './useLiveData';
import styles from './admin.module.css';

const createKeys = new IdempotencyKeys('celebrity-create');

const EMPTY_DRAFT: ReviewDraft = { rights_status: 'blocked', max_display: 'name_only', shoppable: false, evidence_ref: '', note: '' };

export function CelebritiesScreen() {
  const list = useLiveData<CelebrityList>('/v1/celebrities', DEMO_CELEBRITIES, 'the celebrities');
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => setRole(tokenRole()), []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.value.items.filter((c) => !q || c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q)));
  }, [list.value.items, query]);
  const current = selected ?? items[0]?.id ?? null;
  const matrix = { ...DEFAULT_MATRIX, ...(list.value.matrix ?? {}) };

  return (
    <>
      <h1 className="sr-only">Admin: celebrities and rights</h1>
      <AdminSection title="Celebrities and rights" titleId="celebrities-title" badge={<LiveBadge demo={list.demo} cause={list.cause} />}>
        <LiveBanner notice={list.notice} />
        <PageNote>
          Nothing about a celebrity is published until counsel&apos;s review allows it. Only the rights reviewer sets Editorial or Cleared, with the
          evidence reference; anyone here may set Blocked. Every change is kept in the history below and needs a note.
          {role ? ` You are signed in as ${role.replace(/_/g, ' ')}.` : ''}
        </PageNote>
        <MatrixTable matrix={matrix} />
        <div className={styles.split}>
          <div>
            <Field label="Find">
              <Input type="search" compact value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or alias" />
            </Field>
            <ul className={`${styles.list} ${styles.gapTop3}`} aria-label="Celebrities" >
              {items.map((c) => (
                <li key={c.id}>
                  <button type="button" className={`${styles.pick} ${c.id === current ? styles.picked : ''}`} onClick={() => setSelected(c.id)} aria-current={c.id === current ? 'true' : undefined}>
                    <span className={styles.pickTitle}>
                      {c.name}
                      <Tag variant={statusTone(c.rights_status)}>{statusLabel(c.rights_status)}</Tag>
                    </span>
                    <span className={styles.muted}>
                      Shows: {allowsText(c.effective)}
                      {c.is_minor ? ' · MINOR' : ''}
                      {c.never_list ? ' · never-list' : ''}
                      {c.takedown_id ? ' · under takedown' : ''}
                    </span>
                  </button>
                </li>
              ))}
              {items.length === 0 ? <li className={`${styles.muted} ${styles.pad3}`}>No celebrity yet: import the library first.</li> : null}
            </ul>
            <CreateCelebrity demo={list.demo} onCreated={(id) => { setSelected(id); void list.reload(); }} />
          </div>
          <div>{current ? <CelebrityPanel id={current} demoList={list.demo} role={role} matrix={matrix} onChanged={() => void list.reload()} /> : null}</div>
        </div>
      </AdminSection>
    </>
  );
}

function MatrixTable({ matrix }: { matrix: Record<string, { display: string; shoppable: boolean }> }) {
  return (
    <div className={`${styles.panel} ${styles.spaced}`}>
      <h2 className={styles.h4}>What each status allows (at most; a default pending counsel)</h2>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Image</th>
            <th>Products and links</th>
            <th>Who sets it</th>
          </tr>
        </thead>
        <tbody>
          {RIGHTS_STATUSES.map((s) => {
            const c = matrix[s] ?? DEFAULT_MATRIX[s];
            return (
              <tr key={s}>
                <td>
                  <Tag variant={statusTone(s)}>{statusLabel(s)}</Tag>
                </td>
                <td>{c.display === 'none' ? 'No' : 'Yes'}</td>
                <td>{c.display === 'name_and_image' ? 'If the review allows it and the licence does' : 'No'}</td>
                <td>{c.shoppable ? 'If the review allows it' : 'No'}</td>
                <td>{s === 'blocked' ? 'Anyone here' : s === 'unreviewed' ? 'The default; the rights reviewer' : 'The rights reviewer only'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={`${styles.muted} ${styles.gapTop2}`}>
        A minor or never-listed celebrity, or one under a takedown, shows nothing whatever the status.
      </p>
    </div>
  );
}

function CelebrityPanel({ id, demoList, role, matrix, onChanged }: { id: string; demoList: boolean; role: string | null; matrix: Record<string, { display: DisplayLevel | string; shoppable: boolean }>; onChanged: () => void }) {
  const detail = useLiveData<CelebrityDetail>(demoList ? null : `/v1/celebrities/${id}`, demoCelebrityDetail(id), 'this celebrity');
  const c = demoList ? demoCelebrityDetail(id) : detail.value;
  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_DRAFT);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setResult(null);
  }, [id]);
  const problems = reviewProblems(draft, role, matrix as Record<string, { display: DisplayLevel; shoppable: boolean }>);
  const ceiling = matrix[draft.rights_status] ?? DEFAULT_MATRIX.unreviewed;

  async function submit() {
    setBusy(true);
    const r = await send<{ celebrity: { effective: { display: string; shoppable: boolean } }; links_paused: number; links_reactivated: number }>(
      `/v1/celebrities/${id}/rights-review`,
      reviewBody(draft),
    );
    setBusy(false);
    if (r.ok) {
      setResult({
        ok: true,
        text: `Recorded. Shows now: ${allowsText(r.data.celebrity.effective as { display: DisplayLevel; shoppable: boolean })}.${r.data.links_paused ? ` ${r.data.links_paused} link(s) paused.` : ''}${r.data.links_reactivated ? ` ${r.data.links_reactivated} link(s) active again.` : ''}`,
      });
      setDraft(EMPTY_DRAFT);
      void detail.reload();
      onChanged();
    } else setResult({ ok: false, text: `${r.message} (${r.code})` });
  }

  return (
    <div className={styles.stack}>
      <div>
        <h2 className={styles.h3}>{c.name}</h2>
        <dl className={styles.facts}>
          <dt>Page name</dt>
          <dd className={styles.mono}>/c/{c.slug}</dd>
          <dt>Status</dt>
          <dd>
            <Tag variant={statusTone(c.rights_status)}>{statusLabel(c.rights_status)}</Tag>
          </dd>
          <dt>Shows now</dt>
          <dd>{allowsText(c.effective)}</dd>
          <dt>Aliases</dt>
          <dd>{c.aliases.length ? c.aliases.join(', ') : '—'}</dd>
          <dt>Flags</dt>
          <dd>{[c.is_minor ? 'Minor (never published)' : null, c.never_list ? 'Never-list' : null, c.takedown_id ? 'Under takedown' : null].filter(Boolean).join(' · ') || 'None'}</dd>
          <dt>Last review</dt>
          <dd>
            {c.rights_reviewed_at ? `${formatDayMonthTime(c.rights_reviewed_at)} · ${c.rights_note ?? ''}` : 'Never reviewed'}
            {c.rights_evidence_ref ? <div className={styles.mono}>Evidence: {c.rights_evidence_ref}</div> : null}
          </dd>
        </dl>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h4}>Record a decision</h3>
        <div className={styles.form}>
          <div className={styles.formRow}>
            <Field label="Status">
              <Select value={draft.rights_status} onChange={(e) => setDraft({ ...draft, rights_status: e.target.value as RightsStatus })} options={RIGHTS_STATUSES.map((s) => ({ value: s, label: `${statusLabel(s)}: ${allowsText(matrix[s] as { display: DisplayLevel; shoppable: boolean })}` }))} />
            </Field>
            {draft.rights_status === 'cleared' ? (
              <Field label="Show at most">
                <Select value={draft.max_display} onChange={(e) => setDraft({ ...draft, max_display: e.target.value as DisplayLevel })} options={[{ value: 'name_only', label: 'Name only' }, { value: 'name_and_image', label: 'Name and image' }]} />
              </Field>
            ) : null}
          </div>
          {draft.rights_status === 'cleared' ? (
            <Checkbox checked={draft.shoppable} onChange={(e) => setDraft({ ...draft, shoppable: e.target.checked })}>
              A page naming them may carry products and links (counsel allowed it)
            </Checkbox>
          ) : null}
          <Field label="Evidence reference" labelSuffix={draft.rights_status === 'editorial' || draft.rights_status === 'cleared' ? '(required)' : '(optional)'} hint="Counsel's written advice or the licence: its file or email reference. No personal data.">
            <Input value={draft.evidence_ref} onChange={(e) => setDraft({ ...draft, evidence_ref: e.target.value })} />
          </Field>
          <Field label="Note" labelSuffix="(required)">
            <Textarea rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </Field>
          <p className={styles.muted}>
            With this decision the celebrity shows at most: {ceiling.display === 'none' ? 'nothing' : draft.rights_status === 'cleared' ? `${displayLabel(draft.max_display)}${draft.shoppable ? ', with products' : ', no products'}` : allowsText(ceiling as { display: DisplayLevel; shoppable: boolean })}.
          </p>
          {problems.length ? (
            <ul className={styles.problems}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className={styles.actions}>
            <Button variant="primary" disabled={demoList || busy || problems.length > 0} onClick={submit}>
              {busy ? 'Recording…' : 'Record the decision'}
            </Button>
            {demoList ? <span className={styles.muted}>Demo data: nothing is sent.</span> : null}
          </div>
          {result ? <p className={result.ok ? styles.okLine : styles.error}>{result.text}</p> : null}
        </div>
      </div>

      <div>
        <h3 className={styles.h4}>History (append-only)</h3>
        {c.reviews.length === 0 ? (
          <p className={styles.muted}>No decision yet: unreviewed (nothing is published).</p>
        ) : (
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th>When</th>
                <th>Decision</th>
                <th>By</th>
                <th>Note and evidence</th>
              </tr>
            </thead>
            <tbody>
              {[...c.reviews].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{r.reviewed_at ? formatDayMonthTime(r.reviewed_at) : '—'}</td>
                  <td>
                    {statusLabel(r.rights_status)}
                    <div className={styles.muted}>
                      {displayLabel(r.max_display)}
                      {r.shoppable ? ', products' : ''}
                      {r.kind !== 'review' ? ` (${r.kind.replace(/_/g, ' ')})` : ''}
                    </div>
                  </td>
                  <td>{r.reviewed_role.replace(/_/g, ' ')}</td>
                  <td>
                    {r.note ?? '—'}
                    {r.evidence_ref ? <div className={styles.mono}>{r.evidence_ref}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3 className={styles.h4}>Looks</h3>
        {c.looks.length === 0 ? (
          <p className={styles.muted}>No look yet.</p>
        ) : (
          <ul className={styles.list}>
            {c.looks.map((l) => (
              <li key={l.id} className={styles.listRow}>
                <a href={`/admin/looks/${l.id}`}>{l.title}</a> <span className={styles.muted}>· {l.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CreateCelebrity({ demo, onCreated }: { demo: boolean; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [minor, setMinor] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function create() {
    const body = { name: name.trim(), aliases: aliases.split(/[;,]/).map((a) => a.trim()).filter(Boolean), is_minor: minor };
    const r = await send<{ id: string }>('/v1/celebrities', body, createKeys.keyFor(body));
    if (r.ok) {
      setMsg({ ok: true, text: `${body.name} created, unreviewed.` });
      setName('');
      setAliases('');
      setMinor(false);
      onCreated(r.data.id);
    } else setMsg({ ok: false, text: `${r.message} (${r.code})` });
  }
  return (
    <details className={styles.gapTop4}>
      <summary className={`${styles.h4} ${styles.summary}`}>
        Add a celebrity by hand
      </summary>
      <div className={`${styles.form} ${styles.gapTop2}`}>
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Aliases" labelSuffix="(optional)" hint="Separated by ; or ,">
          <Input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        <Checkbox checked={minor} onChange={(e) => setMinor(e.target.checked)}>
          A minor (never published; the flag cannot be removed here)
        </Checkbox>
        <div className={styles.actions}>
          <Button disabled={demo || name.trim() === ''} onClick={create}>
            Create (unreviewed)
          </Button>
        </div>
        {msg ? msg.ok ? <p className={styles.okLine}>{msg.text}</p> : <Banner title="Not created.">{msg.text}</Banner> : null}
      </div>
    </details>
  );
}
