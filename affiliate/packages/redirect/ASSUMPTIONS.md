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
