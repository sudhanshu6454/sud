#!/usr/bin/env node
/**
 * mint-links — mint a tracked link for every live offer that has none yet,
 * for ONE placement (the consumer shop's own placement, WEB_PLACEMENT_ID).
 *
 * Usage:
 *   API_BASE=http://localhost:3000 API_TOKEN=<jwt> node scripts/mint-links.mjs --placement <uuid> [--dry-run] [--page-size 100]
 *
 * What it does (read-only until the POST):
 *   1. pages GET /v1/looks (published looks of the token's organisation)
 *   2. GET /v1/looks/:id?placement_id=<placement> per look
 *   3. for every item with a live offer and no link: POST /v1/links
 *      { property_id: placement.property_id, programme_id: offer.programme_id,
 *        offer_id, placement_id } with a deterministic Idempotency-Key
 *      'mint-links:<placement>:<offer_id>' — re-running is safe.
 *
 * Replays. The API stores every response below 500 under its key and replays
 * it (X-Idempotent-Replay: true), so a fixed key alone would repeat an old
 * answer forever. Two cases are handled:
 *   - a replayed 4xx (e.g. OFFER_STALE since fixed): that key minted nothing,
 *     so one retry under a fresh key cannot create a second link;
 *   - a replayed 201: trusted only if the look detail now shows an active
 *     link for that offer (a concurrent run minted it). Otherwise the stored
 *     link was paused since, and a new one is minted under a fresh key.
 *
 * Every id comes from the API; nothing is guessed. API error codes are
 * printed verbatim. Exit codes: 0 all good, 1 any mint failed (or a list /
 * detail call failed), 2 usage error.
 *
 * The bearer token must carry a role allowed to mint (publisher_owner,
 * editor or network_admin). Until the real IdP lands, that token is the
 * DEV STUB from scripts/mint-dev-token.mjs — never use the stub outside
 * local/sandbox environments.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(
    'usage: API_BASE=http://localhost:3000 API_TOKEN=<jwt> node scripts/mint-links.mjs --placement <uuid> [--dry-run] [--page-size 100]',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const dryRun = args.includes('--dry-run');
const placementId = flag('placement');
const pageSize = Number(flag('page-size') ?? '100');

if (!placementId || !UUID_RE.test(placementId)) usage('--placement <uuid> is required');
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) usage('--page-size must be 1..100');

const apiBase = (process.env.API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const token = process.env.API_TOKEN;
if (!token) usage('API_TOKEN is required (dev stub: JWT_SECRET=... node scripts/mint-dev-token.mjs --org-id <org> --role publisher_owner)');

console.error(`mint-links: API ${apiBase}, placement ${placementId}${dryRun ? ' (dry run — no links will be minted)' : ''}`);
console.error('mint-links: NOTE the bearer token is the dev stub (scripts/mint-dev-token.mjs) until the IdP lands.');

class ApiFailure extends Error {
  constructor(status, code, message, replayed = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.replayed = replayed;
  }
}

async function call(method, path, { body, headers } = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const replayed = res.headers.get('x-idempotent-replay') === 'true';
  if (!res.ok) {
    const code = parsed?.error?.code ?? 'INTERNAL';
    const message = parsed?.error?.message ?? `HTTP ${res.status}`;
    throw new ApiFailure(res.status, code, message, replayed);
  }
  return { data: parsed?.data, replayed };
}

/** The active link the API reports right now for (this placement, offerId) in one look, or null. */
async function activeLinkFor(lookId, offerId) {
  const { data } = await call('GET', `/v1/looks/${encodeURIComponent(lookId)}?placement_id=${encodeURIComponent(placementId)}`);
  const item = (Array.isArray(data?.items) ? data.items : []).find((i) => i?.offer?.id === offerId && i?.link);
  return item ? item.link : null;
}

/**
 * POST /v1/links under `baseKey`; on a stale replay (see the header) retry once
 * under a fresh key. Returns { data, replayed, freshKey }.
 */
async function mintLink(body, baseKey, lookId, offerId) {
  let key = baseKey;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await call('POST', '/v1/links', { body, headers: { 'Idempotency-Key': key } });
      if (!res.replayed) return { ...res, freshKey: attempt > 0 };
      const live = await activeLinkFor(lookId, offerId);
      if (live) return { data: live, replayed: true, freshKey: false };
      console.error(`note: offer=${offerId}: key ${key} replayed a link that is no longer active; minting a new one`);
    } catch (err) {
      if (!(err instanceof ApiFailure) || !err.replayed || err.status >= 500 || attempt > 0) throw err;
      console.error(`note: offer=${offerId}: key ${key} replayed an earlier HTTP ${err.status} ${err.code}; retrying under a fresh key`);
    }
    key = `${baseKey}:${Date.now().toString(36)}`;
  }
  throw new Error(`fresh idempotency key for offer ${offerId} was replayed too; giving up`);
}

async function listAllLooks() {
  const looks = [];
  for (let page = 1; page <= 1000; page += 1) {
    const { data } = await call('GET', `/v1/looks?page=${page}&page_size=${pageSize}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    looks.push(...items);
    if (items.length === 0 || looks.length >= Number(data?.total ?? 0)) break;
  }
  return looks;
}

const counts = {
  looks: 0,
  items: 0,
  minted: 0,
  replayed: 0,
  skipped_linked: 0,
  skipped_no_offer: 0,
  skipped_duplicate_offer: 0,
  failed: 0,
};
const failures = [];
const seenOffers = new Set();

let looks;
try {
  looks = await listAllLooks();
} catch (err) {
  if (err instanceof ApiFailure) {
    console.error(`FAILED GET /v1/looks: HTTP ${err.status} ${err.code}: ${err.message}`);
  } else {
    console.error(`FAILED GET /v1/looks: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
}

for (const summary of looks) {
  counts.looks += 1;
  let look;
  try {
    ({ data: look } = await call('GET', `/v1/looks/${encodeURIComponent(summary.id)}?placement_id=${encodeURIComponent(placementId)}`));
  } catch (err) {
    counts.failed += 1;
    const line =
      err instanceof ApiFailure
        ? `FAILED GET /v1/looks/${summary.id}: HTTP ${err.status} ${err.code}: ${err.message}`
        : `FAILED GET /v1/looks/${summary.id}: ${err instanceof Error ? err.message : String(err)}`;
    failures.push(line);
    console.error(line);
    continue;
  }
  const placement = look?.placement;
  if (!placement || !UUID_RE.test(String(placement.property_id ?? ''))) {
    const line = `FAILED look=${summary.id}: detail response carried no placement.property_id — refusing to guess`;
    counts.failed += 1;
    failures.push(line);
    console.error(line);
    continue;
  }
  for (const item of Array.isArray(look.items) ? look.items : []) {
    counts.items += 1;
    const offer = item.offer;
    if (!offer) {
      counts.skipped_no_offer += 1;
      continue;
    }
    if (item.link) {
      counts.skipped_linked += 1;
      continue;
    }
    if (seenOffers.has(offer.id)) {
      counts.skipped_duplicate_offer += 1;
      continue;
    }
    seenOffers.add(offer.id);
    const body = {
      property_id: placement.property_id,
      programme_id: offer.programme_id,
      offer_id: offer.id,
      placement_id: placementId,
    };
    const idempotencyKey = `mint-links:${placementId}:${offer.id}`;
    if (dryRun) {
      console.log(`would mint look=${look.id} item=${item.id} offer=${offer.id} programme=${offer.programme_id} property=${placement.property_id}`);
      counts.minted += 1;
      continue;
    }
    try {
      const { data, replayed, freshKey } = await mintLink(body, idempotencyKey, look.id, offer.id);
      counts.minted += 1;
      if (replayed) counts.replayed += 1;
      const note = replayed ? ' (idempotent replay)' : freshKey ? ' (fresh key after a stale replay)' : '';
      console.log(`minted look=${look.id} item=${item.id} offer=${offer.id} token=${data?.token ?? '?'} url=${data?.url ?? '?'}${note}`);
    } catch (err) {
      counts.failed += 1;
      const line =
        err instanceof ApiFailure
          ? `FAILED look=${look.id} item=${item.id} offer=${offer.id}: HTTP ${err.status} ${err.code}: ${err.message}`
          : `FAILED look=${look.id} item=${item.id} offer=${offer.id}: ${err instanceof Error ? err.message : String(err)}`;
      failures.push(line);
      console.error(line);
    }
  }
}

console.log(
  `summary: looks=${counts.looks} items=${counts.items} ${dryRun ? 'would_mint' : 'minted'}=${counts.minted}` +
    ` replayed=${counts.replayed} skipped_linked=${counts.skipped_linked} skipped_no_offer=${counts.skipped_no_offer}` +
    ` skipped_duplicate_offer=${counts.skipped_duplicate_offer} failed=${counts.failed}`,
);
if (counts.failed > 0) {
  console.error(`${counts.failed} failure(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
