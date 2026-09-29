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

- Raw IP is never stored: only `sha256(ip)` goes into `clicks.context`,
  alongside the user-agent string. X-Forwarded-For is not specially handled;
  `req.ip` follows Fastify's trust-proxy default (direct peer). Put the
  service behind the real edge proxy config before production.

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
