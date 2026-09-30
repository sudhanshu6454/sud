'use client';

/*
 * Takedowns (admin, no artboard). One action withdraws a celebrity (every
 * look of theirs) or one look: every public page answers 410 at once, their
 * links pause, their comment replies stop, the caches are cleared; the
 * answer lists the in-house posts to delete on Meta by hand (Afflino cannot).
 * Live: GET /v1/takedowns (the time each took to act, 1 h and 3 h marks),
 * GET /v1/takedowns/:id (the affected pages), POST /v1/takedowns (with an
 * Idempotency-Key), POST /v1/takedowns/:id/posts-removed, POST
 * /v1/takedowns/:id/restore (the rights reviewer only, after a new review).
 */

import { useEffect, useState } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { Banner, Button, Field, Input, Select, Tag, Textarea } from '@/components/ui';
import { IdempotencyKeys } from '@/lib/idempotency';
import {
  TAKEDOWN_REASONS,
  istLocalToIso,
  reasonLabel,
  slaLabel,
  type CelebrityList,
  type EditorialLookRow,
  type TakedownDetail,
  type TakedownResult,
  type TakedownView,
} from '@/lib/celebrity-admin';
import { DEMO_CELEBRITIES, DEMO_EDITORIAL_LOOKS, DEMO_TAKEDOWNS, demoTakedownDetail } from '@/lib/demo/celebrity';
import { formatDayMonthTime } from '@/lib/format';
import { socialPostUrl } from '@/lib/spotted';
import { LiveBadge, LiveBanner } from './LiveStatus';
import { send, tokenRole, useLiveData } from './useLiveData';
import styles from './admin.module.css';

const keys = new IdempotencyKeys('takedown');

export function TakedownsScreen() {
  const list = useLiveData<{ items: TakedownView[] }>('/v1/takedowns', DEMO_TAKEDOWNS, 'the takedowns');
  const celebs = useLiveData<CelebrityList>('/v1/celebrities', DEMO_CELEBRITIES, 'the celebrities');
  const looks = useLiveData<{ items: EditorialLookRow[] }>('/v1/editorial/looks?page_size=100', DEMO_EDITORIAL_LOOKS, 'the looks');
  const [selected, setSelected] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => setRole(tokenRole()), []);
  const current = selected ?? list.value.items[0]?.id ?? null;
  const nameOf = (t: TakedownView) =>
    t.scope === 'celebrity'
      ? celebs.value.items.find((c) => c.id === t.celebrity_id)?.name ?? 'A celebrity'
      : looks.value.items.find((l) => l.id === t.look_id)?.title ?? 'A look';
  return (
    <>
      <h1 className="sr-only">Admin: takedowns</h1>
      <AdminSection title="Takedowns" titleId="takedowns-title" badge={<LiveBadge demo={list.demo} cause={list.cause} />}>
        <LiveBanner notice={list.notice} />
        <PageNote>
          A notice arrives: take the celebrity or the look down now, and record when the notice was received. Every public page answers 410 at
          once, the links pause and comment replies stop. Afflino cannot delete posts on Facebook or Instagram: the list of posts to delete by hand
          comes with the answer. Only the rights reviewer restores, after a new review.
        </PageNote>
        <TakedownForm demo={list.demo} celebs={celebs.value} looks={looks.value.items} onDone={(id) => { setSelected(id); void list.reload(); }} />
        <div className={`${styles.split} ${styles.gapTop4}`}>
          <div>
            <h2 className={styles.h4}>Takedowns</h2>
            <ul className={styles.list}>
              {list.value.items.map((t) => (
                <li key={t.id}>
                  <button type="button" className={`${styles.pick} ${t.id === current ? styles.picked : ''}`} onClick={() => setSelected(t.id)}>
                    <span className={styles.pickTitle}>
                      {nameOf(t)}
                      <Tag variant={t.status === 'active' ? 'accent' : 'neutral'}>{t.status === 'active' ? 'Active' : 'Restored'}</Tag>
                    </span>
                    <span className={styles.muted}>
                      {t.scope === 'celebrity' ? 'Every look' : 'One look'} · {reasonLabel(t.reason_code)} · acted in {slaLabel(t.sla, t.minutes_to_action)}
                    </span>
                  </button>
                </li>
              ))}
              {list.value.items.length === 0 ? <li className={`${styles.muted} ${styles.pad3}`}>No takedown.</li> : null}
            </ul>
          </div>
          <div>{current ? <TakedownPanel id={current} demo={list.demo} role={role} name={(t) => nameOf(t)} onChanged={() => void list.reload()} /> : null}</div>
        </div>
      </AdminSection>
    </>
  );
}

function TakedownForm({ demo, celebs, looks, onDone }: { demo: boolean; celebs: CelebrityList; looks: EditorialLookRow[]; onDone: (id: string) => void }) {
  const [f, setF] = useState({ scope: 'look' as 'look' | 'celebrity', target: '', reason: 'rights_holder_request', ref: '', when: '', note: '' });
  const [result, setResult] = useState<TakedownResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const targets = f.scope === 'celebrity' ? celebs.items.map((c) => ({ value: c.id, label: c.name })) : looks.filter((l) => !l.takedown_id).map((l) => ({ value: l.id, label: `${l.celebrity.name} · ${l.title} (${l.status})` }));
  const body = {
    scope: f.scope,
    ...(f.scope === 'celebrity' ? { celebrity_id: f.target } : { look_id: f.target }),
    reason_code: f.reason,
    reason_note: f.note.trim() || null,
    requester_ref: f.ref.trim() || null,
    requested_at: istLocalToIso(f.when),
  };
  async function submit() {
    setConfirming(false);
    setError(null);
    const r = await send<TakedownResult>('/v1/takedowns', body, keys.keyFor(body));
    if (!r.ok) {
      setError(`${r.message} (${r.code})`);
      return;
    }
    setResult(r.data);
    onDone(r.data.takedown.id);
  }
  return (
    <div className={styles.panel}>
      <h2 className={styles.h4}>Take down now</h2>
      <div className={styles.form}>
        <div className={styles.formRow}>
          <Field label="What">
            <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as 'look' | 'celebrity', target: '' })} options={[{ value: 'look', label: 'One look' }, { value: 'celebrity', label: 'A celebrity: every look' }]} />
          </Field>
          <Field label={f.scope === 'celebrity' ? 'Celebrity' : 'Look'}>
            <Select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="Choose" options={targets} />
          </Field>
          <Field label="Reason">
            <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={TAKEDOWN_REASONS.map((r) => ({ value: r, label: reasonLabel(r) }))} />
          </Field>
        </div>
        <div className={styles.formRow}>
          <Field label="The notice's reference" labelSuffix="(optional)" hint="Its number or file reference; no names">
            <Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
          </Field>
          <Field label="Received (India time)" labelSuffix="(empty = now)">
            <Input type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />
          </Field>
        </div>
        <Field label="Note" labelSuffix="(optional)">
          <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <div className={styles.actions}>
          {confirming ? (
            <>
              <Button variant="primary" onClick={() => void submit()}>
                Confirm: withdraw {f.scope === 'celebrity' ? 'every look' : 'this look'} now
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={demo || !f.target} onClick={() => setConfirming(true)}>
              Take down
            </Button>
          )}
          {demo ? <span className={styles.muted}>Demo data: nothing is sent.</span> : null}
        </div>
        {error ? <Banner title="The takedown did not run.">{error}</Banner> : null}
        {result ? (
          <div>
            <p className={styles.okLine}>
              {result.created ? 'Done' : 'Already active'}: {result.looks_withdrawn} look(s) withdrawn (410 on every public page), {result.links_paused} link(s) paused, {result.rules_disabled} comment-reply rule(s) off,{' '}
              {result.replies_cancelled} queued repl(y/ies) cancelled. Acted {slaLabel(result.takedown.sla, result.takedown.minutes_to_action)} after the notice.
            </p>
            {result.looks_named_in_text?.length ? (
              <p className={styles.muted}>{result.looks_named_in_text.length} other look(s) whose text names this person withdrawn too.</p>
            ) : null}
            {result.other_links_paused ? <p className={styles.muted}>{result.other_links_paused} other page link(s) for these products paused.</p> : null}
            {result.posts_to_delete.length ? <PostsList posts={result.posts_to_delete} /> : null}
            {result.share_urls?.length ? <ShareUrls urls={result.share_urls} /> : null}
            {result.stills?.length ? (
              <div className={styles.gapTop2}>
                <h3 className={styles.h4}>The stills (their afflino.com address answers 410 now)</h3>
                <ul className={styles.list}>
                  {result.stills.map((st) => (
                    <li key={st.asset_id} className={styles.listRow}>
                      <span className={styles.mono}>{st.source_ref ?? st.asset_id}</span>
                      <span className={styles.muted}> · remove the origin file too if counsel asks</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function platformName(p: string | null): string {
  return p === 'instagram' ? 'Instagram' : p === 'facebook' ? 'Facebook' : 'the platform';
}

function PostsList({ posts }: { posts: Array<{ look_id: string; platform: string | null; account: string | null; post_permalink: string | null; platform_post_id: string | null; post_removed_at?: string | null }> }) {
  return (
    <div className={styles.gapTop2}>
      <h3 className={styles.h4}>Delete these posts on Facebook / Instagram yourself</h3>
      <ul className={styles.list}>
        {posts.map((p) => {
          const href = socialPostUrl(p.post_permalink);
          return (
            <li key={p.look_id} className={styles.listRow}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={styles.strong}>
                  Open the post on {platformName(p.platform)} <span aria-hidden="true">→</span>
                </a>
              ) : (
                <span className={styles.strong}>
                  {p.platform}/{p.account}
                </span>
              )}
              <div className={styles.mono}>{p.post_permalink ?? p.platform_post_id ?? 'no post recorded'}</div>
              {p.post_removed_at ? <span className={styles.muted}>deleted {formatDayMonthTime(p.post_removed_at)}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The afflino.com addresses whose cached link previews Meta should scrape again (its Sharing Debugger). */
function ShareUrls({ urls }: { urls: string[] }) {
  return (
    <div className={styles.gapTop2}>
      <h3 className={styles.h4}>Link previews: scrape these again in Meta&apos;s Sharing Debugger</h3>
      <ul className={styles.list}>
        {urls.map((u) => (
          <li key={u} className={styles.listRow}>
            <a href={`https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(u)}`} target="_blank" rel="noopener noreferrer" className={styles.strong}>
              Scrape again <span aria-hidden="true">→</span>
            </a>
            <div className={styles.mono}>{u}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TakedownPanel({ id, demo, role, name, onChanged }: { id: string; demo: boolean; role: string | null; name: (t: TakedownView) => string; onChanged: () => void }) {
  const detail = useLiveData<TakedownDetail>(demo ? null : `/v1/takedowns/${id}`, demoTakedownDetail(id), 'this takedown');
  const t = demo ? demoTakedownDetail(id) : detail.value;
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function restore() {
    const r = await send<{ looks: Array<{ look_id: string; status: string }>; links_reactivated: number }>(`/v1/takedowns/${id}/restore`, { note: note.trim() });
    if (r.ok) {
      setMsg({ ok: true, text: `Restored: ${r.data.looks.map((l) => l.status).join(', ')}; ${r.data.links_reactivated} link(s) active again. Comment replies stay off.` });
      void detail.reload();
      onChanged();
    } else setMsg({ ok: false, text: `${r.message} (${r.code})` });
  }
  async function markRemoved() {
    const r = await send<{ marked: number }>(`/v1/takedowns/${id}/posts-removed`, { look_ids: t.looks.map((l) => l.look_id) });
    if (r.ok) {
      setMsg({ ok: true, text: `${r.data.marked} post(s) recorded as deleted.` });
      void detail.reload();
    } else setMsg({ ok: false, text: `${r.message} (${r.code})` });
  }
  return (
    <div className={styles.stack}>
      <h2 className={styles.h3}>{name(t)}</h2>
      <dl className={styles.facts}>
        <dt>Scope</dt>
        <dd>{t.scope === 'celebrity' ? 'The celebrity: every look' : 'One look'}</dd>
        <dt>Reason</dt>
        <dd>
          {reasonLabel(t.reason_code)}
          {t.reason_note ? ` · ${t.reason_note}` : ''}
        </dd>
        <dt>Notice</dt>
        <dd>{t.requester_ref ?? '—'}</dd>
        <dt>Received</dt>
        <dd>{t.requested_at ? formatDayMonthTime(t.requested_at) : '—'}</dd>
        <dt>Acted</dt>
        <dd>
          {t.actioned_at ? formatDayMonthTime(t.actioned_at) : '—'} ({slaLabel(t.sla, t.minutes_to_action)})
        </dd>
        <dt>Caches cleared</dt>
        <dd>{t.completed_at ? formatDayMonthTime(t.completed_at) : 'Not yet'}</dd>
        <dt>Effect</dt>
        <dd>
          {t.looks_withdrawn} look(s), {t.links_paused} link(s) paused, {t.rules_disabled} reply rule(s) off
        </dd>
        <dt>Status</dt>
        <dd>
          {t.status === 'active' ? 'Active' : `Restored ${t.restored_at ? formatDayMonthTime(t.restored_at) : ''}${t.restore_note ? ` · ${t.restore_note}` : ''}`}
        </dd>
      </dl>
      <div>
        <h3 className={styles.h4}>Affected pages</h3>
        <ul className={styles.list}>
          {t.looks.map((l) => (
            <li key={l.look_id} className={styles.listRow}>
              <a href={`/looks/${l.look_id}`} target="_blank" rel="noopener noreferrer" className={styles.strong}>
                {l.previous_status === 'published' ? 'Check it answers 410' : 'Check it answers 404 (never public)'} <span aria-hidden="true">→</span>
              </a>
              <div>
                <span className={styles.mono}>/looks/{l.look_id}</span> <span className={styles.muted}>· was {l.previous_status}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {t.looks.length ? <PostsList posts={t.looks} /> : null}
      <div className={styles.actions}>
        <Button size="sm" disabled={demo || t.looks.every((l) => l.post_removed_at)} onClick={() => void markRemoved()}>
          I deleted these posts
        </Button>
      </div>
      {t.status === 'active' ? (
        <div className={styles.panel}>
          <h3 className={styles.h4}>Restore</h3>
          <p className={styles.muted}>
            The rights reviewer only, and only after a new review of the celebrity recorded after this takedown. Links come back only where the new
            review allows products.
          </p>
          {role !== null && role !== 'rights_reviewer' ? (
            <p className={styles.okLine}>Your role cannot restore: the rights reviewer signs in to do it.</p>
          ) : (
            <>
              <Field label="Why it is lifted" labelSuffix="(required)">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={demo} />
              </Field>
              <div className={`${styles.actions} ${styles.gapTop2}`}>
                <Button disabled={demo || note.trim().length < 3} onClick={() => void restore()}>
                  Restore
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {msg ? msg.ok ? <p className={styles.okLine}>{msg.text}</p> : <Banner title="Not done.">{msg.text}</Banner> : null}
    </div>
  );
}
