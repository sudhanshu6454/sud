# @paparazzi/redirect — ASSUMPTIONS.md

## Blocking context (as of 2026-09-22)

- **`packages/shared/src/` was empty when this was written.** `src/shared-shim.d.ts`
  is the same TEMPORARY ambient declaration as in the API package — delete it
  when the real contract lands and re-run typecheck. Only `apiError`,
  `buildEnvelope` (and the `EventEnvelope` type) are used here.

## Tenant scoping

- The route lookup is by `links.token` alone — a deliberate, documented
  exception to the org_id-everywhere rule: the token is a 128-bit
  unguessable bearer secret with a global unique constraint, so the lookup
  returns at most one row and reveals nothing enumerable. Every *write*
  (the `clicks` insert) uses the `org_id` read back from the link row.

## Fail-open (deliberate)

- Click persistence / BullMQ enqueue failures redirect anyway without a
  `click_id` (no subid param). Event loss is logged at error level with the
  token and attempted click_id. If product wants fail-closed instead, flip
  the `catch` in `handleRedirect` to return 500 — but that trades shopper
  journeys for attribution completeness.

## Privacy

- Raw IP is never stored: only a hash of it goes into `clicks.context`
  (`ip_hash`), alongside the user-agent string.
- **Which address (2026-09-29): `TRUST_PROXY`.** Passed to Fastify's
  `trustProxy` via `parseTrustProxy` (`packages/shared/src/trust-proxy.ts`):
  unset / empty / `false` = trust nothing (`req.ip` is the TCP peer, the
  behaviour before the setting existed); `true`; a hop count; or a comma
  list of addresses, CIDRs and proxy-addr names (`loopback`, `linklocal`,
  `uniquelocal`). An invalid value fails the boot. docker-compose.prod.yml
  sets `loopback,uniquelocal`: the edge (Caddy, `docker/Caddyfile`) is the
  peer, and it overwrites any client-supplied X-Forwarded-For / X-Real-IP /
  Forwarded, so the address hashed is the one the edge saw. Tested in
  `test/client-ip.test.ts` (trusted peer + XFF → the forwarded client;
  untrusted peer or unset → the peer) and end to end through the edge
  (`docker/README.md` smoke test: a spoofed X-Forwarded-For does not change
  the stored hash).
- **How (2026-09-29): `IP_HASH_KEY`.** When set, `ip_hash` =
  HMAC-SHA256(key, ip) as hex (`hashClientAddress`); unset or empty keeps
  the plain SHA-256 of before, so existing rows and the tests' expectations
  stay valid. A plain SHA-256 of an IPv4 address is reversible by
  enumerating the 2^32 addresses; the HMAC is not without the key. A key
  shorter than 32 characters (after trimming) fails the boot; the error
  never echoes it. Consequences: hashes made under different keys — or
  before and after the key was first set — do not compare, so per-address
  fraud checks (`docs/runbooks/publisher-fraud.md`) only work within one
  key's lifetime; set the key before the first real click and do not rotate
  it casually. The keyed hash is still a stable pseudonymous value per
  address: whether it is personal data, who holds the key and how long it
  may be kept are counsel items (`docs/threat-model.md` §4.11,
  `docs/counsel-briefing.md` §8), not a compliance claim.
- The request log records method, url and hostname only (`requestLogFields`,
  `packages/shared/src/request-log.ts`), never Fastify's default
  `remoteAddress` / `remotePort`: with TRUST_PROXY set that would be the
  shopper's real address in the clear.
- Production boot guard: under `NODE_ENV=production` the service refuses to
  start without `REDIS_URL` (without it clicks would be persisted but never
  enqueued); docker-compose.prod.yml leaves the check to the service because
  docker-compose.single-host.yml supplies the value.

## Misc

- BullMQ queue name is `click-events`, job name `click.observed`;
  `removeOnComplete: 1000, removeOnFail: 5000` caps queue growth. BullMQ gets
  its own Redis connection (`maxRetriesPerRequest: null`, as required).
- Cache TTLs: 600s on link-creation warm (API), 300s on DB-fallback rebuild.
  Programme pause/resume now invalidates `route:{token}` entries explicitly
  (`POST /v1/programmes/:id/pause|resume` in the API), so propagation is
  immediate when Redis is available; TTL expiry is only the fallback when it
  is not (see "Phase 3 — kill switch behaviour" below).
- `route_signature` (HMAC) is written by the API but not yet verified here;
  TODO once the signing key moves to KMS (see API ASSUMPTIONS.md).
- Paused-page copy is minimal English HTML; locale-aware pages are a TODO.

## Phase 3 (2026-09-22) — kill switch behaviour

- The paused page (HTTP 200, `text/html`, no redirect) is served whenever
  the route payload's `programme_status`/`offer_status` is not `active` or
  the offer is past `fresh_until`. This is the kill switch's enforcement
  point: `POST /v1/programmes/:id/pause` flips the DB status and deletes
  `route:{token}` cache entries, so the next request re-reads the DB and
  serves the paused page. Resume invalidates the same keys so a payload
  cached while paused cannot keep serving the paused page until TTL expiry.
- The service sets no cookies and reads none; denying consent changes
  nothing observable on this path (covered by the phase-3 acceptance test).

## Amazon.in Associates routes (2026-09-29)

- The route payload may carry `strip_params`, `set_params`, `crawler_guard`, `route_block` and
  `subid_field: null` (built by `amazonRouteParams` in @paparazzi/shared, identically at mint
  and in the DB fallback). A payload without `subid_field` (every one written before) keeps
  `subid`; an explicit null adds no click id at all.
- For Amazon: `tag`, `ascsubtag` and `subid` are removed, `tag` = the link placement's tracking
  ID (else the account's store ID) is set, and no click id is ever added — sub-tags are off and
  cannot be turned on (LR: "Under no circumstances may you associate any sub-tag with a
  specific end user of your site"; the setting was removed on review, 2026-09-29). The tag is
  set before the click insert, so the fail-open 302 keeps it.
- The DB fallback now also joins the link's placement, its property, the Amazon account, the
  placement's tracking ID and a live `owner_operated` verification (LEFT joins, each keyed to
  the link's org). A disabled account, a property no longer approved or no longer
  owner-operated, or a property on a platform Amazon links may not go on (anything but
  Facebook, Instagram and web: `isAmazonAcceptedPlatform`) serves the paused page (logged with
  the reason).
  A verification change has no invalidation hook: a cached route keeps redirecting for up to
  600 s (mint) / 300 s (rebuild).
- **Automated clients, prefetches and HEAD** (Amazon routes only): a 200 HTML page with no
  click row and no Amazon URL in it (its words: `AMAZON_PREVIEW_PAGE` in @paparazzi/shared,
  drafts pending counsel — link cards show them under every post). PR 27 bars creating
  Sessions on the Amazon Site "by way of a robot or software program"; PR 25 bars Amazon pages
  opened "other than as a result of the customer clicking". Matched: `LINK_PREVIEW_CRAWLER_RE`
  (named previewers and crawlers, generic `bot` (not `CUBOT` phones) / `crawl` / `spider` /
  `scrap` / `preview` / `headless` tokens, curl, wget, python-requests, Go, okhttp, Java,
  Apache HttpClient, libwww, axios, node-fetch, undici, …), a missing or empty user agent, and
  `isSpeculativeRequest` (`Sec-Purpose: prefetch` / `prefetch;prerender`, `Purpose:
  prefetch`, `X-Purpose: preview`, `X-Moz: prefetch`). In-app browsers are people and are not
  matched. A heuristic, counsel to confirm; a bot that sends a browser's user agent still gets
  the 302.
- Every `/r/` response carries `X-Robots-Tag: noindex, nofollow` (OA §7 excludes fees on
  Redirecting Links shown in organic search results).
