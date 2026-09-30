'use client';

/*
 * Comment replies (Afflino's own name for comment-keyword replies; admin, no
 * artboard): a rule per post of an in-house page (keywords → ONE private
 * reply carrying only the look's afflino.com page; an optional public
 * answer, one of the fixed texts), the exact message that would go out, on / off, the Meta
 * accounts' messaging status, and the latest events without personal data.
 * Live: GET/POST /v1/replies/rules, POST /v1/replies/rules/:id, GET
 * /v1/replies/accounts, GET /v1/replies/events. Sending itself is the
 * owner's server switch (looks.sh replies off | shadow | on).
 */

import { useState } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { Banner, Button, Field, Input, Select, Tag } from '@/components/ui';
import { IdempotencyKeys } from '@/lib/idempotency';
import {
  PUBLIC_REPLY_TEMPLATES,
  eventStatusLabel,
  parseKeywords,
  publicReplyProblem,
  type EditorialLookRow,
  type MetaAccount,
  type ReplyEvent,
  type ReplyRule,
} from '@/lib/celebrity-admin';
import { DEMO_ACCOUNTS, DEMO_EDITORIAL_LOOKS, DEMO_EVENTS, DEMO_RULES } from '@/lib/demo/celebrity';
import { formatDayMonthTime } from '@/lib/format';
import { LiveBadge, LiveBanner } from './LiveStatus';
import { send, useLiveData } from './useLiveData';
import styles from './admin.module.css';

const keys = new IdempotencyKeys('reply-rule');

export function CommentRepliesScreen() {
  const rules = useLiveData<{ items: ReplyRule[]; public_reply_templates?: string[] }>('/v1/replies/rules', DEMO_RULES, 'the reply rules');
  const templates = rules.value.public_reply_templates ?? PUBLIC_REPLY_TEMPLATES;
  const accounts = useLiveData<{ items: MetaAccount[] }>('/v1/replies/accounts', DEMO_ACCOUNTS, 'the Meta accounts');
  const events = useLiveData<{ items: ReplyEvent[] }>('/v1/replies/events?limit=50', DEMO_EVENTS, 'the reply events');
  const looks = useLiveData<{ items: EditorialLookRow[] }>('/v1/editorial/looks?status=published&page_size=100', { items: DEMO_EDITORIAL_LOOKS.items.filter((l) => l.status === 'published') }, 'the published looks');
  const lookName = (id: string) => {
    const l = looks.value.items.find((x) => x.id === id);
    return l ? `${l.celebrity.name} · ${l.title}` : id;
  };
  return (
    <>
      <h1 className="sr-only">Admin: comment replies</h1>
      <AdminSection title="Comment replies" titleId="replies-title" badge={<LiveBadge demo={rules.demo} cause={rules.cause} />}>
        <LiveBanner notice={rules.notice} />
        <PageNote>
          Someone comments a keyword on the post → one private reply with the look&apos;s afflino.com page (never a tracked link, never an Amazon link),
          within Meta&apos;s 7 days, once per comment; STOP opts them out. Sending is switched on the server (off by default; shadow checks everything
          and sends nothing) and needs Meta&apos;s App Review and counsel&apos;s privacy notice first.
        </PageNote>
        <NewRule demo={rules.demo} looks={looks.value.items} templates={templates} onCreated={() => void rules.reload()} />
        <h2 className={`${styles.h4} ${styles.gapTop4}`}>
          Rules
        </h2>
        {rules.value.items.length === 0 ? <p className={styles.muted}>No rule yet.</p> : null}
        {rules.value.items.map((r) => (
          <RuleCard key={r.id} rule={r} demo={rules.demo} lookName={lookName(r.look_id)} templates={templates} onChanged={() => void rules.reload()} />
        ))}
      </AdminSection>
      <AdminSection title="Meta accounts" titleId="accounts-title" badge={<LiveBadge demo={accounts.demo} cause={accounts.cause} />}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th>Page</th>
              <th>Meta id</th>
              <th>Messaging</th>
              <th>Checked</th>
            </tr>
          </thead>
          <tbody>
            {accounts.value.items.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.platform}: {a.account}
                </td>
                <td className={styles.mono}>{a.meta_account_id}</td>
                <td>
                  {a.messaging_status}
                  {a.last_error_code ? ` (${a.last_error_code})` : ''}
                </td>
                <td>{a.checked_at ? formatDayMonthTime(a.checked_at) : 'Never'}</td>
              </tr>
            ))}
            {accounts.value.items.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.muted}>
                  No account mapped yet: the server step looks.sh accounts maps the pages.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </AdminSection>
      <AdminSection title="Latest events" titleId="events-title" badge={<LiveBadge demo={events.demo} cause={events.cause} />}>
        <p className={styles.muted}>No comment text, no username, no commenter id: only when, which page, which keyword and what happened.</p>
        <table className={`${styles.matrix} ${styles.gapTop2}`}>
          <thead>
            <tr>
              <th>Received</th>
              <th>Page</th>
              <th>Keyword</th>
              <th>Status</th>
              <th>Look</th>
            </tr>
          </thead>
          <tbody>
            {events.value.items.map((e) => (
              <tr key={e.id}>
                <td>{e.received_at ? formatDayMonthTime(e.received_at) : '—'}</td>
                <td>
                  {e.platform}: {e.account}
                </td>
                <td>{e.matched_keyword}</td>
                <td>
                  {eventStatusLabel(e.status)}
                  {e.error_code ? <span className={styles.muted}> ({e.error_code})</span> : null}
                </td>
                <td className={styles.muted}>{lookName(e.look_id)}</td>
              </tr>
            ))}
            {events.value.items.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.muted}>
                  No event yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </AdminSection>
    </>
  );
}

/** The public answer: none, or one of the fixed texts (a select, never free text). */
function PublicAnswer({ value, templates, onChange, problem }: { value: string; templates: readonly string[]; onChange: (v: string) => void; problem: string | null }) {
  return (
    <Field label="Public answer" labelSuffix="(optional, one of the fixed texts)" error={problem ?? undefined}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: 'No public answer' }, ...templates.map((t) => ({ value: t, label: t }))]} />
    </Field>
  );
}

function RuleCard({ rule, demo, lookName, templates, onChanged }: { rule: ReplyRule; demo: boolean; lookName: string; templates: readonly string[]; onChanged: () => void }) {
  const [kw, setKw] = useState(rule.keywords.join(', '));
  const [pub, setPub] = useState(rule.public_reply ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pubProblem = publicReplyProblem(pub, templates);
  async function save(body: Record<string, unknown>, label: string) {
    const r = await send(`/v1/replies/rules/${rule.id}`, body);
    if (r.ok) {
      setMsg({ ok: true, text: `${label}.` });
      onChanged();
    } else setMsg({ ok: false, text: `${r.message} (${r.code})` });
  }
  return (
    <div className={`${styles.panel} ${styles.gapTop2}`}>
      <div className={styles.pieceHead}>
        <strong>{lookName}</strong>
        <Tag variant={rule.enabled ? 'accent' : 'neutral'}>{rule.enabled ? 'On' : 'Off'}</Tag>
        {rule.disabled_by_takedown_id ? <Tag variant="ink">Off: takedown</Tag> : null}
        <span className={styles.muted}>post {rule.platform_post_id}</span>
      </div>
      <div className={`${styles.split} ${styles.noRuleTop}`}>
        <div className={styles.form}>
          <Field label="Keywords" hint="Up to 10, separated by commas; a comment matches a whole word">
            <Input value={kw} onChange={(e) => setKw(e.target.value)} />
          </Field>
          <PublicAnswer value={pub} templates={templates} onChange={setPub} problem={pubProblem} />
          <div className={styles.actions}>
            <Button size="sm" disabled={demo || !!pubProblem} onClick={() => void save({ keywords: parseKeywords(kw), public_reply: pub.trim() || null }, 'Saved')}>
              Save
            </Button>
            <Button size="sm" variant={rule.enabled ? 'ghost' : 'primary'} disabled={demo} onClick={() => void save({ enabled: !rule.enabled }, rule.enabled ? 'Turned off' : 'Turned on')}>
              {rule.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          {msg ? msg.ok ? <p className={styles.okLine}>{msg.text}</p> : <p className={styles.error}>{msg.text}</p> : null}
        </div>
        <div>
          <h3 className={styles.h4}>The private reply, exactly</h3>
          {rule.dm_preview ? (
            <>
              <pre className={styles.pre}>{rule.dm_preview}</pre>
              <p className={styles.muted}>{rule.dm_bytes} of 1000 bytes · a draft pending counsel</p>
            </>
          ) : (
            <p className={styles.error}>Not sendable: {rule.dm_refusal}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NewRule({ demo, looks, templates, onCreated }: { demo: boolean; looks: EditorialLookRow[]; templates: readonly string[]; onCreated: () => void }) {
  const [f, setF] = useState({ look: '', post: '', keywords: 'link, price', pub: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pubProblem = publicReplyProblem(f.pub, templates);
  async function create() {
    const body = { look_id: f.look, keywords: parseKeywords(f.keywords), ...(f.post.trim() ? { platform_post_id: f.post.trim() } : {}), public_reply: f.pub.trim() || null };
    const r = await send<ReplyRule>('/v1/replies/rules', body, keys.keyFor(body));
    if (r.ok) {
      setMsg({ ok: true, text: 'Rule created (off: turn it on below).' });
      onCreated();
    } else setMsg({ ok: false, text: `${r.message} (${r.code})` });
  }
  return (
    <details className={styles.panel}>
      <summary className={`${styles.h4} ${styles.summary} ${styles.noMargin}`}>
        + A rule for a published look&apos;s post
      </summary>
      <div className={`${styles.form} ${styles.gapTop2}`}>
        <div className={styles.formRow}>
          <Field label="Look">
            <Select value={f.look} onChange={(e) => setF({ ...f, look: e.target.value })} placeholder="Choose a published look" options={looks.map((l) => ({ value: l.id, label: `${l.celebrity.name} · ${l.title}` }))} />
          </Field>
          <Field label="The post's id" labelSuffix="(empty = the look's)">
            <Input value={f.post} onChange={(e) => setF({ ...f, post: e.target.value })} />
          </Field>
        </div>
        <Field label="Keywords">
          <Input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
        </Field>
        <PublicAnswer value={f.pub} templates={templates} onChange={(v) => setF({ ...f, pub: v })} problem={pubProblem} />
        <div className={styles.actions}>
          <Button disabled={demo || !f.look || !!pubProblem || parseKeywords(f.keywords).length === 0} onClick={() => void create()}>
            Create the rule
          </Button>
        </div>
        {msg ? msg.ok ? <p className={styles.okLine}>{msg.text}</p> : <Banner title="Not created.">{msg.text}</Banner> : null}
      </div>
    </details>
  );
}
