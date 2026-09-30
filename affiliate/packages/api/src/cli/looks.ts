/**
 * Celebrity looks operator CLI — ships in the api image
 * (node dist/cli/looks.js …; in the repo: tsx src/cli/looks.ts …).
 * DATABASE_URL is required; REDIS_URL (optional) lets takedown / restore /
 * review clear the redirect's cached routes; WEB_REVALIDATE_URL +
 * WEB_REVALIDATE_SECRET (optional) let them clear the web's page caches.
 * Output: one JSON document on stdout; progress and refusals on stderr. Exit
 * 0 ok, 1 refused / failed, 2 usage. The owner's lines are
 * deploy/linode/looks.sh (single lines; the values are asked at prompts).
 *
 *   import       --file <library.csv> [--org-slug afflino]
 *                the paparazzi library (src/looks/library-import.ts): assets with their licence
 *                metadata, celebrities (new ones 'unreviewed'), DRAFT looks and their pieces;
 *                refused as a whole on any problem; a re-run changes nothing
 *   ownership    [--preview yes | --record yes | --withdraw yes] [--copyright-owner <legal name>]
 *                [--acquisition staff|other] [--reason <text>] [--org-slug afflino]
 *                the owner's statement that the organisation owns its library footage
 *                (src/looks/ownership.ts): without a flag the statement in force and where the
 *                assets' licences came from; --preview the statement's words, nothing written;
 *                --record records it (as the organisation's first network_admin, dated, audited;
 *                a library row without licence columns then takes its licence from it);
 *                --withdraw ends it and narrows every asset licensed by it (no image shown)
 *   status       [--org-slug afflino]    counts for the check step
 *   celebrities  [--status unreviewed|editorial|cleared|blocked] [--org-slug afflino]
 *   review       --celebrity <slug> --status <status> [--max-display none|name_only|name_and_image]
 *                [--shoppable yes|no] [--evidence-ref <ref>] [--note <text>] [--org-slug afflino]
 *                records counsel's decision as the organisation's rights reviewer (a placeholder
 *                member rights_reviewer@<org>.invalid is created the first time); editorial and
 *                cleared need the evidence reference and a note
 *   takedown     (--celebrity <slug> | --look <uuid>) --reason <code> [--requester-ref <ref>]
 *                [--requested-at <ISO time the notice arrived>] [--note <text>] [--org-slug afflino]
 *                as the organisation's first network_admin
 *   restore      --takedown <uuid> --note <text> [--org-slug afflino]    as the rights reviewer
 *                (needs a review of the celebrity recorded after the takedown)
 *   takedowns    [--status active|restored] [--org-slug afflino]
 *   storefronts  [--file <storefronts.csv>] [--publish yes] [--org-slug afflino]
 *                a draft storefront for every approved, owner-operated Facebook / Instagram
 *                property without one; with a file (platform,account,slug,display_name[,bio][,status])
 *                those rows are applied; --publish yes makes every draft storefront live (hidden
 *                ones stay hidden); the answer lists every storefront with its bio URL
 *                (SITE_URL/s/<slug>, the link-in-bio address; public only once live)
 *   events       [--limit 20] [--org-slug afflino]
 *                the latest comment-reply events: time, page, keyword, status (no comment id,
 *                no commenter hash, no message id)
 *   reply-test   --look <uuid> [--webhook <api base, e.g. http://api:3000>] [--org-slug afflino]
 *                the exact private reply for the look, checked like the workers check it and
 *                handed to a stub sender (nothing is sent to Meta); with --webhook also the
 *                webhook's own checks: the verify-token handshake, a signed TEST delivery for
 *                an account no page is mapped to (200, nothing stored) and a wrongly signed one
 *                (401). The secrets are read from the environment and never printed.
 *   sign-in      --role network_admin|editor|rights_reviewer [--hours 8] [--org-slug afflino]
 *                a short-lived bearer for the admin's dev sign-in (/login) as the organisation's
 *                first network_admin, its second editor (the person who approves an EXACT tag,
 *                never its tagger: a user of its own) or its rights reviewer (the JWT stub,
 *                signed with JWT_SECRET). The answer holds the token: looks.sh signin writes it
 *                to a root-only file and never prints it.
 *
 * Real library data, celebrity names and decisions live on the server, never
 * in this repository; its fixtures are TEST data ("Demo Star …", example.com),
 * refused under NODE_ENV=production.
 */
import { readFile } from 'node:fs/promises';

const USAGE = `usage:
  looks import --file <library.csv> [--org-slug afflino]
  looks ownership [--preview yes | --record yes | --withdraw yes] [--copyright-owner <legal name>]
                  [--acquisition staff|other] [--reason <text>] [--org-slug afflino]
  looks status [--org-slug afflino]
  looks celebrities [--status <status>] [--org-slug afflino]
  looks review --celebrity <slug> --status <status> [--max-display <level>] [--shoppable yes|no]
               [--evidence-ref <ref>] [--note <text>] [--org-slug afflino]
  looks takedown (--celebrity <slug> | --look <uuid>) --reason <code> [--requester-ref <ref>]
                 [--requested-at <iso>] [--note <text>] [--org-slug afflino]
  looks restore --takedown <uuid> --note <text> [--org-slug afflino]
  looks takedowns [--status active|restored] [--org-slug afflino]
  looks storefronts [--file <storefronts.csv>] [--publish yes] [--org-slug afflino]
  looks events [--limit 20] [--org-slug afflino]
  looks reply-test --look <uuid> [--webhook <api base>] [--org-slug afflino]
  looks sign-in --role network_admin|editor|rights_reviewer [--hours 8] [--org-slug afflino]`;

class UsageError extends Error {}
type Flags = Map<string, string>;

export function parseLooksFlags(argv: string[]): { command: string | null; flags: Flags } {
  const args = argv.filter((a) => a !== '--');
  const command = args[0] && !args[0].startsWith('--') ? args[0] : null;
  const flags: Flags = new Map();
  for (let i = command ? 1 : 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument '${a}'`);
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const value = eq > 0 ? a.slice(eq + 1) : args[i + 1];
    if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new UsageError(`--${name} needs a value`);
    flags.set(name, value);
    if (eq < 0) i += 1;
  }
  return { command, flags };
}

function str(flags: Flags, name: string): string | undefined {
  const v = flags.get(name);
  return v !== undefined && v.trim() !== '' ? v.trim() : undefined;
}

const log = {
  warn: (obj: unknown, msg?: string) => console.error(`looks: warning: ${msg ?? ''} ${JSON.stringify(obj)}`),
};

async function orgId(flags: Flags): Promise<{ id: string; slug: string }> {
  const { getPool } = await import('../db.js');
  const slug = str(flags, 'org-slug') ?? 'afflino';
  const org = (await getPool().query<{ id: string }>(`select id from organisations where slug = $1`, [slug])).rows[0];
  if (!org) throw new Error(`no organisation '${slug}'`);
  return { id: org.id, slug };
}

async function firstAdmin(org: string): Promise<string> {
  const { getPool } = await import('../db.js');
  const r = (
    await getPool().query<{ user_id: string }>(
      `select user_id from memberships where org_id = $1 and role = 'network_admin' order by created_at, user_id limit 1`,
      [org],
    )
  ).rows[0];
  if (!r) throw new Error('no network_admin member (db/seed-network.ts seeds one); the audit row needs a real user');
  return r.user_id;
}

/** The organisation's rights reviewer: its first rights_reviewer member, else the placeholder created now. */
export async function ensureRightsReviewer(org: { id: string; slug: string }): Promise<string> {
  return ensureRoleMember(org, 'rights_reviewer', 'Rights reviewer (counsel)', 'the rights reviewer');
}

/**
 * The organisation's second editor: its first `editor` member, else the placeholder created now.
 * A user of its own (never the network admin who tags), so the EXACT approval's maker-checker
 * (`approved_by <> tagged_by`) holds; the JWT stub cannot tell people apart, so the owner hands
 * this sign-in to a different person.
 */
export async function ensureSecondEditor(org: { id: string; slug: string }): Promise<string> {
  return ensureRoleMember(org, 'editor', 'Second editor', 'the second editor');
}

async function ensureRoleMember(org: { id: string; slug: string }, role: 'rights_reviewer' | 'editor', displayName: string, what: string): Promise<string> {
  const { getPool } = await import('../db.js');
  const pool = getPool();
  const have = (
    await pool.query<{ user_id: string }>(
      `select user_id from memberships where org_id = $1 and role = $2 order by created_at, user_id limit 1`,
      [org.id, role],
    )
  ).rows[0];
  if (have) return have.user_id;
  const email = `${role}@${org.slug}.invalid`;
  const user =
    (await pool.query<{ id: string }>(`select id from users where email = $1`, [email])).rows[0] ??
    (await pool.query<{ id: string }>(`insert into users (email, display_name) values ($1, $2) returning id`, [email, displayName])).rows[0];
  if (!user) throw new Error(`could not create ${what} placeholder`);
  const member = (await pool.query<{ role: string }>(`select role from memberships where user_id = $1 and org_id = $2`, [user.id, org.id])).rows[0];
  if (member && member.role !== role) throw new Error(`${email} is a '${member.role}' member; give ${what} its own user`);
  if (!member) await pool.query(`insert into memberships (user_id, org_id, role) values ($1, $2, $3)`, [user.id, org.id, role]);
  console.error(`looks: ${what} is the placeholder ${email} (created now)`);
  return user.id;
}

async function celebrityId(org: string, slug: string): Promise<string> {
  const { tenantQuery } = await import('../db.js');
  const r = (await tenantQuery<{ id: string }>(org, `select id from celebrities where org_id = $1 and slug = $2`, [slug])).rows[0];
  if (!r) throw new Error(`no celebrity '${slug}' (looks celebrities lists them)`);
  return r.id;
}

async function runImport(flags: Flags): Promise<unknown> {
  const file = str(flags, 'file');
  if (!file) throw new UsageError('--file <library.csv> is required');
  const { importLibrary } = await import('../looks/library-import.js');
  const org = await orgId(flags);
  const actor = await firstAdmin(org.id).catch(() => null);
  return importLibrary({ orgSlug: org.slug, text: await readFile(file, 'utf8'), actorId: actor });
}

async function runOwnership(flags: Flags): Promise<unknown> {
  const own = await import('../looks/ownership.js');
  const modes = (['preview', 'record', 'withdraw'] as const).filter((m) => flags.has(m));
  if (modes.length > 1) throw new UsageError('one of --preview, --record, --withdraw');
  const mode = modes[0];
  if (mode && str(flags, mode) !== 'yes') throw new UsageError(`--${mode} yes`);
  if (mode === 'preview' || mode === 'record') {
    const name = str(flags, 'copyright-owner') ?? '';
    const acquisition = str(flags, 'acquisition') ?? '';
    const problems = own.ownershipProblems(name, acquisition);
    if (problems.length) throw new Error(problems.join('; '));
    const clean = name.replace(/\s+/g, ' ').trim();
    if (mode === 'preview') return { preview: true, copyright_owner: clean, acquisition, statement: own.ownershipStatementText(clean, acquisition as 'staff' | 'other') };
    const org = await orgId(flags);
    const out = await own.recordOwnershipStatement(org.id, await firstAdmin(org.id), { copyright_owner: clean, acquisition });
    return { recorded: true, ...out };
  }
  const org = await orgId(flags);
  if (mode === 'withdraw') {
    const reason = str(flags, 'reason');
    if (!reason) throw new UsageError('--reason <text> is required with --withdraw');
    const out = await own.withdrawOwnershipStatement(org.id, await firstAdmin(org.id), reason);
    return { withdrawn: true, withdrawal_id: out.withdrawn, assets_narrowed: out.assets_narrowed };
  }
  const { tenantQuery } = await import('../db.js');
  const current = await own.ownershipStatementFor(org.id);
  const via = (
    await tenantQuery<{ via: string | null; commercial_reuse: string; n: number }>(
      org.id,
      `select licence_via as via, commercial_reuse, count(*)::int as n from assets where org_id = $1 and kind in ('still', 'video')
        group by licence_via, commercial_reuse order by licence_via, commercial_reuse`,
    )
  ).rows;
  const history = (await tenantQuery<{ n: number }>(org.id, `select count(*)::int as n from library_ownership_statements where org_id = $1`)).rows[0]?.n ?? 0;
  return { statement: current, statements_recorded: Number(history), assets_by_licence: via.map((r) => ({ via: r.via ?? 'none', commercial_reuse: r.commercial_reuse, assets: Number(r.n) })) };
}

async function runStatus(flags: Flags): Promise<unknown> {
  const { tenantQuery } = await import('../db.js');
  const org = await orgId(flags);
  const group = async (sql: string) =>
    Object.fromEntries((await tenantQuery<{ k: string; n: string | number }>(org.id, sql)).rows.map((r) => [r.k, Number(r.n)]));
  return {
    org_id: org.id,
    celebrities_by_status: await group(`select rights_status as k, count(*) as n from celebrities where org_id = $1 group by rights_status`),
    looks_by_status: await group(`select status as k, count(*) as n from looks where org_id = $1 and celebrity_id is not null group by status`),
    pieces: await group(`select 'pieces' as k, count(*) as n from look_pieces where org_id = $1 and removed_at is null`),
    items_by_match: await group(
      `select match_type || ':' || review_state as k, count(*) as n from look_items where org_id = $1 and piece_id is not null and removed_at is null group by match_type, review_state`,
    ),
    assets_by_kind: await group(`select kind as k, count(*) as n from assets where org_id = $1 and kind is not null group by kind`),
    takedowns_by_status: await group(`select status as k, count(*) as n from takedowns where org_id = $1 group by status`),
    storefronts_by_status: await group(`select status as k, count(*) as n from storefronts where org_id = $1 group by status`),
    reply_rules: await group(`select case when enabled then 'enabled' else 'disabled' end as k, count(*) as n from reply_rules where org_id = $1 group by enabled`),
    reply_events_by_status: await group(`select status as k, count(*) as n from reply_events where org_id = $1 group by status`),
    meta_accounts_by_status: await group(`select messaging_status as k, count(*) as n from meta_accounts where org_id = $1 group by messaging_status`),
  };
}

async function runCelebrities(flags: Flags): Promise<unknown> {
  const { tenantQuery } = await import('../db.js');
  const { CELEBRITY_COLS } = await import('../looks/bundle.js');
  const { celebrityView } = await import('../looks/celebrities.js');
  const org = await orgId(flags);
  const status = str(flags, 'status');
  const rows = (
    await tenantQuery(
      org.id,
      `select ${CELEBRITY_COLS} from celebrities c where c.org_id = $1 ${status ? 'and c.rights_status = $2' : ''} order by c.name`,
      status ? [status] : [],
    )
  ).rows;
  return { items: rows.map((r) => celebrityView(r as Parameters<typeof celebrityView>[0])) };
}

async function runReview(flags: Flags): Promise<unknown> {
  const { isRightsStatus, isDisplayLevel } = await import('@paparazzi/shared');
  const slug = str(flags, 'celebrity');
  const status = str(flags, 'status');
  if (!slug || !status) throw new UsageError('--celebrity <slug> and --status are required');
  if (!isRightsStatus(status)) throw new UsageError('--status is unreviewed, editorial, cleared or blocked');
  const maxDisplay = str(flags, 'max-display');
  if (maxDisplay !== undefined && !isDisplayLevel(maxDisplay)) throw new UsageError('--max-display is none, name_only or name_and_image');
  const shoppable = str(flags, 'shoppable');
  if (shoppable !== undefined && shoppable !== 'yes' && shoppable !== 'no') throw new UsageError('--shoppable is yes or no');
  const { reviewCelebrity, celebrityView } = await import('../looks/celebrities.js');
  const org = await orgId(flags);
  const reviewer = await ensureRightsReviewer(org);
  const out = await reviewCelebrity(
    org.id,
    { id: reviewer, role: 'rights_reviewer' },
    await celebrityId(org.id, slug),
    {
      rights_status: status,
      ...(maxDisplay ? { max_display: maxDisplay } : {}),
      shoppable: shoppable === 'yes',
      note: str(flags, 'note') ?? null,
      evidence_ref: str(flags, 'evidence-ref') ?? null,
    },
    log,
  );
  return { celebrity: celebrityView(out.celebrity), review_id: out.review_id, links_paused: out.links_paused, links_reactivated: out.links_reactivated, invalidation: out.invalidation };
}

async function runTakedown(flags: Flags): Promise<unknown> {
  const { TAKEDOWN_REASONS, takeDown } = await import('../looks/takedown.js');
  const celebrity = str(flags, 'celebrity');
  const look = str(flags, 'look');
  if (!!celebrity === !!look) throw new UsageError('exactly one of --celebrity <slug> or --look <uuid>');
  const reason = str(flags, 'reason');
  if (!reason || !(TAKEDOWN_REASONS as readonly string[]).includes(reason)) throw new UsageError(`--reason is one of ${TAKEDOWN_REASONS.join(' | ')}`);
  if (look && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(look)) throw new UsageError('--look is a look uuid');
  const org = await orgId(flags);
  const actor = await firstAdmin(org.id);
  const { __lastRouteCacheSecondDelete } = await import('../routes/programmes.js');
  const out = await takeDown(
    org.id,
    actor,
    {
      scope: celebrity ? 'celebrity' : 'look',
      ...(celebrity ? { celebrity_id: await celebrityId(org.id, celebrity) } : { look_id: look as string }),
      reason_code: reason as (typeof TAKEDOWN_REASONS)[number],
      reason_note: str(flags, 'note') ?? null,
      requester_ref: str(flags, 'requester-ref') ?? null,
      requested_at: str(flags, 'requested-at') ?? null,
    },
    log,
  );
  await __lastRouteCacheSecondDelete();
  return out;
}

async function runRestore(flags: Flags): Promise<unknown> {
  const id = str(flags, 'takedown');
  const note = str(flags, 'note');
  if (!id || !note) throw new UsageError('--takedown <uuid> and --note are required');
  const { restoreTakedown } = await import('../looks/takedown.js');
  const org = await orgId(flags);
  const reviewer = await ensureRightsReviewer(org);
  const { __lastRouteCacheSecondDelete } = await import('../routes/programmes.js');
  const out = await restoreTakedown(org.id, { id: reviewer, role: 'rights_reviewer' }, id, note, log);
  await __lastRouteCacheSecondDelete();
  return out;
}

async function runTakedowns(flags: Flags): Promise<unknown> {
  const { listTakedowns } = await import('../looks/takedown.js');
  const org = await orgId(flags);
  const status = str(flags, 'status');
  if (status !== undefined && status !== 'active' && status !== 'restored') throw new UsageError('--status is active or restored');
  return { items: await listTakedowns(org.id, status as 'active' | 'restored' | undefined) };
}

async function runStorefronts(flags: Flags): Promise<unknown> {
  const { tenantQuery } = await import('../db.js');
  const { upsertStorefront } = await import('../looks/editorial.js');
  const { propertyIsOwnerOperated } = await import('../amazon/account.js');
  const { parseCsv } = await import('../delimited.js');
  const org = await orgId(flags);
  const actor = await firstAdmin(org.id);
  const props = (
    await tenantQuery<{ id: string; platform: string; account: string; sid: string | null }>(
      org.id,
      `select p.id, p.platform, p.external_account_id as account, s.id as sid
         from properties p left join storefronts s on s.property_id = p.id and s.org_id = $1
        where p.org_id = $1 and p.status = 'approved' and p.platform in ('facebook', 'instagram')
        order by p.platform, p.external_account_id`,
    )
  ).rows;
  let created = 0;
  let updated = 0;
  const refused: string[] = [];
  const file = str(flags, 'file');
  const byKey = new Map(props.map((p) => [`${p.platform}:${p.account.toLowerCase()}`, p]));
  if (file) {
    const rows = parseCsv(await readFile(file, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
    const header = (rows[0] ?? []).map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
    const col = (n: string) => header.indexOf(n);
    for (const need of ['platform', 'account', 'slug', 'display_name']) if (col(need) < 0) throw new Error(`storefronts file: missing column '${need}'`);
    for (const [i, cells] of rows.slice(1).entries()) {
      const get = (n: string) => (col(n) >= 0 ? (cells[col(n)] ?? '').trim() : '');
      const p = byKey.get(`${get('platform').toLowerCase()}:${get('account').replace(/^@/, '').toLowerCase()}`);
      if (!p) {
        refused.push(`row ${i + 2}: no approved ${get('platform')} property '${get('account')}'`);
        continue;
      }
      const status = get('status') || undefined;
      try {
        await upsertStorefront(
          org.id,
          actor,
          {
            ...(p.sid ? { id: p.sid } : { property_id: p.id }),
            slug: get('slug'),
            display_name: get('display_name'),
            ...(get('bio') ? { bio: get('bio') } : {}),
            ...(status ? { status: status as 'draft' | 'live' | 'hidden' } : {}),
          },
          log,
        );
        if (p.sid) updated += 1;
        else {
          created += 1;
          p.sid = 'created';
        }
      } catch (err) {
        refused.push(`row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  for (const p of props) {
    if (p.sid) continue;
    if (!(await propertyIsOwnerOperated(org.id, p.id))) continue;
    try {
      await upsertStorefront(org.id, actor, { property_id: p.id }, log);
      created += 1;
    } catch (err) {
      refused.push(`${p.platform}:${p.account}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let published = 0;
  const publish = str(flags, 'publish');
  if (publish !== undefined && publish !== 'yes' && publish !== 'no') throw new UsageError('--publish is yes or no');
  if (publish === 'yes') {
    const drafts = (await tenantQuery<{ id: string }>(org.id, `select id from storefronts where org_id = $1 and status = 'draft' order by slug`)).rows;
    for (const d of drafts) {
      try {
        await upsertStorefront(org.id, actor, { id: d.id, status: 'live' }, log);
        published += 1;
      } catch (err) {
        refused.push(`storefront ${d.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const counts = Object.fromEntries(
    (await tenantQuery<{ status: string; n: string | number }>(org.id, `select status, count(*) as n from storefronts where org_id = $1 group by status`)).rows.map((r) => [
      r.status,
      Number(r.n),
    ]),
  );
  const { siteOrigin } = await import('../looks/instant-links.js');
  const storefronts = (
    await tenantQuery<{ slug: string; display_name: string; status: string; platform: string; account: string }>(
      org.id,
      `select s.slug, s.display_name, s.status, p.platform, p.external_account_id as account
         from storefronts s join properties p on p.id = s.property_id and p.org_id = $1
        where s.org_id = $1 order by p.platform, p.external_account_id`,
    )
  ).rows.map((r) => ({ ...r, bio_url: `${siteOrigin()}/s/${r.slug}` }));
  return { created, updated, published, refused, storefronts_by_status: counts, storefronts };
}

async function runEvents(flags: Flags): Promise<unknown> {
  const { recentReplyEvents } = await import('../looks/replies.js');
  const org = await orgId(flags);
  const raw = str(flags, 'limit') ?? '20';
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new UsageError('--limit is 1-200');
  return { items: await recentReplyEvents(org.id, { limit }) };
}

/** A TEST Instagram account id no page is mapped to (the delivery below is dropped before anything is stored). */
export const REPLY_TEST_ACCOUNT_ID = '990000000000000001';

async function runReplyTest(flags: Flags): Promise<unknown> {
  const look = str(flags, 'look');
  if (!look || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(look)) throw new UsageError('--look <uuid> is required');
  const { buildReplyText, replyTextRefusal, utf8ByteLength } = await import('@paparazzi/shared');
  const { loadLookBundle, publicVisibility } = await import('../looks/bundle.js');
  const { listRules, lookSendable } = await import('../looks/replies.js');
  const { lookPageUrl, siteOrigin } = await import('../looks/instant-links.js');
  const org = await orgId(flags);
  const b = await loadLookBundle(org.id, look);
  if (!b || !b.look.celebrity_id) throw new Error(`no celebrity look ${look}`);
  const lookUrl = lookPageUrl(look);
  let text: string | null = null;
  let refusal: string | null = null;
  try {
    text = buildReplyText({ lookUrl, siteOrigin: siteOrigin() });
    refusal = replyTextRefusal(text, siteOrigin());
  } catch (err) {
    refusal = err instanceof Error ? err.message.replace(/^reply text refused: /, '') : 'refused';
  }
  // The stub sender: records the one private reply the workers would send; nothing leaves this process.
  const stub: Array<{ kind: 'private'; text: string }> = [];
  if (text && !refusal) stub.push({ kind: 'private', text });
  const rules = (await listRules(org.id, look)).map((r) => ({ id: r.id, keywords: r.keywords, enabled: r.enabled, public_reply: r.public_reply }));
  const out: Record<string, unknown> = {
    look_id: look,
    look_public: publicVisibility(b) === 'ok',
    look_sendable: await lookSendable(org.id, look),
    look_url: lookUrl,
    dm_text: text,
    dm_bytes: text ? utf8ByteLength(text) : null,
    dm_refusal: refusal,
    stub_sender: { private_replies: stub.length, sent_to_meta: 0 },
    rules,
  };
  const base = str(flags, 'webhook');
  if (base) out.webhook = await webhookSelfCheck(base.replace(/\/+$/, ''), org.id);
  return out;
}

/** The webhook's own checks against a running api; the secrets come from the environment and are never printed. */
async function webhookSelfCheck(base: string, org: string) {
  const { createHmac, randomBytes } = await import('node:crypto');
  const { getPool } = await import('../db.js');
  const url = `${base}/v1/integrations/meta/webhook`;
  const verify = process.env.META_VERIFY_TOKEN?.trim() ?? '';
  const secret = process.env.META_APP_SECRET?.trim() ?? '';
  const result: Record<string, unknown> = { url_checked: url };
  if (!verify) result.verify = 'META_VERIFY_TOKEN is not set (looks.sh webhook)';
  else {
    const challenge = randomBytes(8).toString('hex');
    const res = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verify)}&hub.challenge=${challenge}`);
    const body = await res.text();
    result.verify = res.status === 200 && body === challenge ? 'ok: the challenge came back' : `refused: HTTP ${res.status}`;
    const wrong = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=not-the-token&hub.challenge=${challenge}`);
    result.verify_wrong_token = wrong.status === 403 ? 'ok: 403' : `unexpected: HTTP ${wrong.status}`;
  }
  if (!secret) {
    result.signed_delivery = 'META_APP_SECRET is not set (looks.sh keys)';
    return result;
  }
  const mapped = (await getPool().query(`select 1 from meta_accounts where meta_account_id = $1`, [REPLY_TEST_ACCOUNT_ID])).rows.length > 0;
  if (mapped) {
    result.signed_delivery = `skipped: the TEST account id ${REPLY_TEST_ACCOUNT_ID} is mapped to a page`;
    return result;
  }
  const payload = JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: REPLY_TEST_ACCOUNT_ID,
        time: Math.floor(Date.now() / 1000),
        changes: [{ field: 'comments', value: { from: { id: '990000000000000002', username: 'afflino.test' }, id: `990${Date.now()}`, text: 'link', media: { id: '990000000000000003' } } }],
      },
    ],
  });
  const sign = (key: string) => `sha256=${createHmac('sha256', key).update(Buffer.from(payload, 'utf8')).digest('hex')}`;
  const good = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(secret) }, body: payload });
  const goodBody = (await good.json().catch(() => null)) as { data?: { unmapped_accounts?: number; queued?: number } } | null;
  result.signed_delivery =
    good.status === 200 && goodBody?.data?.unmapped_accounts === 1 && goodBody.data.queued === 0
      ? 'ok: 200, signature accepted, nothing stored (no page is mapped to the TEST account)'
      : `unexpected: HTTP ${good.status}`;
  const bad = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(`${secret}-wrong`) }, body: payload });
  result.wrongly_signed_delivery = bad.status === 401 ? 'ok: 401' : `unexpected: HTTP ${bad.status}`;

  // A STOP sent as a message (the `messages` field) reaches the opt-out list: a signed message from a TEST
  // sender to the first mapped page; the suppression row it writes (a keyed hash of the TEST sender) is
  // checked, then removed again.
  const hashKey = process.env.COMMENT_ID_HASH_KEY?.trim() ?? '';
  const acct = (await getPool().query<{ platform: string; meta_account_id: string }>(`select platform, meta_account_id from meta_accounts where org_id = $1 order by created_at, id limit 1`, [org])).rows[0];
  if (!acct) result.messaging_stop = 'skipped: no page is mapped yet (looks.sh accounts)';
  else if (!hashKey) result.messaging_stop = 'skipped: COMMENT_ID_HASH_KEY is not set';
  else {
    const sender = '990000000000000009';
    const stopBody = JSON.stringify({
      object: acct.platform === 'instagram' ? 'instagram' : 'page',
      entry: [
        {
          id: acct.meta_account_id,
          time: Math.floor(Date.now() / 1000),
          messaging: [{ sender: { id: sender }, recipient: { id: acct.meta_account_id }, timestamp: Date.now(), message: { mid: `m_test_${Date.now()}`, text: 'STOP' } }],
        },
      ],
    });
    const signStop = `sha256=${createHmac('sha256', secret).update(Buffer.from(stopBody, 'utf8')).digest('hex')}`;
    const stop = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signStop }, body: stopBody });
    const hash = createHmac('sha256', hashKey).update(`${acct.platform}:${acct.meta_account_id}:${sender}`).digest('hex');
    const row = (await getPool().query(`select 1 from reply_suppressions where org_id = $1 and platform = $2 and commenter_hash = $3`, [org, acct.platform, hash])).rows.length;
    await getPool().query(`delete from reply_suppressions where org_id = $1 and platform = $2 and commenter_hash = $3`, [org, acct.platform, hash]);
    result.messaging_stop = stop.status === 200 && row === 1 ? 'ok: 200, the STOP message wrote the opt-out (the TEST row was removed again)' : `unexpected: HTTP ${stop.status}, opt-out rows ${row}`;
  }
  const stored = Number((await getPool().query<{ n: string }>(`select count(*) as n from reply_events where org_id = $1 and meta_account_id = $2`, [org, REPLY_TEST_ACCOUNT_ID])).rows[0]?.n ?? 0);
  result.events_stored_for_test_account = stored;
  return result;
}

async function runSignIn(flags: Flags): Promise<unknown> {
  const role = str(flags, 'role');
  if (role !== 'network_admin' && role !== 'editor' && role !== 'rights_reviewer') throw new UsageError('--role is network_admin, editor or rights_reviewer');
  const hours = Number(str(flags, 'hours') ?? '8');
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new UsageError('--hours is 1-24');
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error('JWT_SECRET is not set (the api service carries it)');
  const org = await orgId(flags);
  const sub = role === 'network_admin' ? await firstAdmin(org.id) : role === 'editor' ? await ensureSecondEditor(org) : await ensureRightsReviewer(org);
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ sub, org_id: org.id, role }, secret, { expiresIn: `${hours}h` });
  return { role, sub, org_id: org.id, expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(), token };
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseLooksFlags(argv);
  } catch (err) {
    console.error(`looks: ${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  if (!parsed.command) {
    console.error(USAGE);
    return 2;
  }
  const commands: Record<string, (f: Flags) => Promise<unknown>> = {
    import: runImport,
    ownership: runOwnership,
    status: runStatus,
    celebrities: runCelebrities,
    review: runReview,
    takedown: runTakedown,
    restore: runRestore,
    takedowns: runTakedowns,
    storefronts: runStorefronts,
    events: runEvents,
    'reply-test': runReplyTest,
    'sign-in': runSignIn,
  };
  const run = commands[parsed.command];
  if (!run) {
    console.error(`looks: unknown command '${parsed.command}'\n${USAGE}`);
    return 2;
  }
  try {
    console.log(JSON.stringify(await run(parsed.flags), null, 2));
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`looks: ${err.message}\n${USAGE}`);
      return 2;
    }
    console.error(`looks: ${(err as Error).message}`);
    return 1;
  } finally {
    await closeConnections();
  }
}

async function closeConnections(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { redis } = await import('../redis.js');
    const r = redis();
    if (r) r.disconnect();
    const { pool } = await import('../db.js');
    await pool.end();
  } catch {
    // best-effort; the process exits next
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
