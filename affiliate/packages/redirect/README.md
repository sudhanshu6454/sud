# @paparazzi/redirect

Standalone public redirect service: `GET /r/{token}`. No auth — this is the
hot path. Keep it lean: Fastify + `pg` + `ioredis` + `bullmq`.

## Run

```bash
# from the repo root
pnpm --filter @paparazzi/redirect dev
```

Env vars:

| Var | Default | Purpose |
|---|---|---|
| `REDIRECT_PORT` | `3001` | Listen port |
| `DATABASE_URL` | — (required) | Postgres (route fallback + click writes) |
| `REDIS_URL` | — (optional) | Route cache + BullMQ transport; service works without it |

## Hot-path sequence (`GET /r/:token`)

1. **Token format check** — must match `/^[0-9a-f]{32}$/` → else `404 NOT_FOUND`.
2. **Route resolve** — `GET route:{token}` from Redis. On miss: single-query DB
   fallback (`links` ⨝ `offers` ⨝ `programmes` ⨝ `programme_capabilities`),
   then best-effort cache rebuild (TTL 300s). Unknown token → `404`.
3. **Eligibility** — programme and offer must be `active` and the offer fresh;
   otherwise serve the **paused page** (`200`, HTML "This link is paused…",
   no redirect).
4. **Open-redirect guard** — `new URL(destination_url).hostname` must be in
   the programme's `allowed_hosts` → else `403 PROGRAMME_NOT_APPROVED`
   (fail closed; logged).
5. **Click capture** — `click_id = randomUUID()`; insert into `clicks`
   (`context = { ua, ip_hash }` — the IP is stored only as a SHA-256 hash,
   never raw) and enqueue a `click-events` BullMQ job with
   `buildEnvelope({ source: 'redirect', event_type: 'click.observed', … })`.
6. **302** to `destination_url` with the subid query param (`subid_field`,
   default `subid`) set to `click_id`.

## Fail-open behavior

If step 5 fails (DB down, Redis/queue down), the service **still 302s to the
approved destination WITHOUT a click_id** — no subid param is appended.
The click is lost, but the failure is loudly observable in logs
(`click persistence failed; redirecting without click_id (event loss)`).
Rationale: a tracking outage must never break the shopper's journey to the
merchant. Event loss is contained to attribution, not revenue flow.

## Paused page

A programme pause, offer deactivation, or stale `fresh_until` serves HTTP 200
with a short HTML page ("This link is paused…") instead of redirecting.
Deliberately not a redirect — there is no approved destination anymore.

## Health

`GET /healthz` → `200 { ok: true }` (no auth, no DB touch).
