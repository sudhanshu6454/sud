/**
 * Map the in-house Facebook Pages and Instagram accounts to their Meta ids
 * (meta_accounts), from the system user's GET /me/accounts:
 *   - a Facebook property matches a Page by its external_account_id (the
 *     page ID, or the page's username);
 *   - an Instagram property (stored by handle) matches the Instagram
 *     business account linked to a Page, by username; its linked_page_id is
 *     that Page (whose token sends its replies);
 *   - messaging_status 'ok' when the system user's tasks on the Page include
 *     MESSAGING, else 'disabled' (Meta: MESSAGING is not assignable through
 *     the API; give the system user full control).
 * With `subscribe`, each matched Page is subscribed to the `feed`,
 * `messages` and `messaging_policy_enforcement` webhook fields (POST
 * /{page}/subscribed_apps; the same fields as the App Dashboard step of
 * `looks.sh webhook`). Instagram's
 * fields are set in Meta's App Dashboard only.
 *
 * The summary carries counts and handles, never a token.
 */
import type { Pool } from 'pg';
import type { GraphClient, PageTokenStore } from './graph';

export interface SyncSummary {
  pages_seen: number;
  instagram_seen: number;
  mapped_facebook: number;
  mapped_instagram: number;
  messaging_ok: number;
  messaging_disabled: number;
  subscribed: number;
  subscribe_failed: number;
  unmatched_properties: { facebook: string[]; instagram: string[] };
}

async function upsert(pool: Pool, orgId: string, propertyId: string, platform: string, metaId: string, linkedPageId: string | null, status: string): Promise<void> {
  const taken = (await pool.query<{ property_id: string }>(`select property_id from meta_accounts where platform = $1 and meta_account_id = $2`, [platform, metaId])).rows[0];
  if (taken && taken.property_id !== propertyId) throw new Error(`the ${platform} account ${metaId} is mapped to another property already`);
  const cur = (await pool.query<{ id: string }>(`select id from meta_accounts where org_id = $1 and property_id = $2`, [orgId, propertyId])).rows[0];
  if (cur) {
    await pool.query(
      `update meta_accounts set meta_account_id = $3, linked_page_id = $4, messaging_status = $5, last_error_code = null,
              paused_until = null, checked_at = now(), updated_at = now()
        where org_id = $1 and id = $2`,
      [orgId, cur.id, metaId, linkedPageId, status],
    );
  } else {
    await pool.query(
      `insert into meta_accounts (org_id, property_id, platform, meta_account_id, linked_page_id, messaging_status, checked_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [orgId, propertyId, platform, metaId, linkedPageId, status],
    );
  }
}

export async function syncMetaAccounts(
  pool: Pool,
  tokens: PageTokenStore,
  graph: GraphClient,
  opts: { orgSlug: string; subscribe?: boolean },
): Promise<SyncSummary> {
  const org = (await pool.query<{ id: string }>(`select id from organisations where slug = $1`, [opts.orgSlug])).rows[0];
  if (!org) throw new Error(`no organisation '${opts.orgSlug}'`);
  const orgId = org.id;
  tokens.invalidate();
  const pages = await tokens.load();
  const props = (
    await pool.query<{ id: string; platform: string; account: string }>(
      `select id, platform, lower(external_account_id) as account from properties
        where org_id = $1 and status = 'approved' and platform in ('facebook', 'instagram')`,
      [orgId],
    )
  ).rows;
  const fb = new Map(props.filter((p) => p.platform === 'facebook').map((p) => [p.account, p.id]));
  const ig = new Map(props.filter((p) => p.platform === 'instagram').map((p) => [p.account, p.id]));
  const out: SyncSummary = {
    pages_seen: pages.length,
    instagram_seen: pages.filter((p) => p.instagramId).length,
    mapped_facebook: 0,
    mapped_instagram: 0,
    messaging_ok: 0,
    messaging_disabled: 0,
    subscribed: 0,
    subscribe_failed: 0,
    unmatched_properties: { facebook: [], instagram: [] },
  };
  const matchedFb = new Set<string>();
  const matchedIg = new Set<string>();
  for (const p of pages) {
    const status = p.tasks.includes('MESSAGING') ? 'ok' : 'disabled';
    const fbProp = fb.get(p.pageId) ?? (p.pageUsername ? fb.get(p.pageUsername.toLowerCase()) : undefined);
    if (fbProp) {
      await upsert(pool, orgId, fbProp, 'facebook', p.pageId, p.pageId, status);
      matchedFb.add(fbProp);
      out.mapped_facebook += 1;
      if (status === 'ok') out.messaging_ok += 1;
      else out.messaging_disabled += 1;
      if (opts.subscribe) {
        const token = await tokens.tokenFor(p.pageId);
        const res = token
          ? await graph.call<{ success?: boolean | string }>('POST', `/${encodeURIComponent(p.pageId)}/subscribed_apps`, token, undefined, { subscribed_fields: 'feed,messages,messaging_policy_enforcement' })
          : null;
        if (res?.ok) out.subscribed += 1;
        else out.subscribe_failed += 1;
      }
    }
    if (p.instagramId && p.instagramUsername) {
      const igProp = ig.get(p.instagramUsername.toLowerCase());
      if (igProp) {
        await upsert(pool, orgId, igProp, 'instagram', p.instagramId, p.pageId, status);
        matchedIg.add(igProp);
        out.mapped_instagram += 1;
        if (status === 'ok') out.messaging_ok += 1;
        else out.messaging_disabled += 1;
      }
    }
  }
  for (const [account, id] of fb) if (!matchedFb.has(id)) out.unmatched_properties.facebook.push(account);
  for (const [account, id] of ig) if (!matchedIg.has(id)) out.unmatched_properties.instagram.push(account);
  out.unmatched_properties.facebook.sort();
  out.unmatched_properties.instagram.sort();
  return out;
}
