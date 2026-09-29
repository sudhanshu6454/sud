# Capacity plan — the affiliate platform behind the Marketing Fleet

Dated 2026-09-29. Status: **a plan built on one owner-supplied figure and
stated assumptions; nothing in it has been measured on real traffic.**
Every number below is either quoted from a file or test output in this
repository, or arithmetic from an assumption named in the same sentence.

## 1. The input figure

The owner's figure is **about 12 billion views a month** across the fleet's
five websites and their social accounts (Instagram, Facebook, X, LinkedIn,
Pinterest, Telegram, Threads). It is the owner's figure, not a measurement
made by anything in this repository; nothing here counts views.

Arithmetic on it:

- 12 000 000 000 / (30 × 86 400 s) ≈ **4 630 views/s** on average.
- Views are not the platform's load. Most of them are social impressions,
  and on Instagram the caption link is plain text (the fleet's own README:
  "image only, link as text"), so a tracked link can only be clicked from an
  article page, a bio page, or a channel that renders links. The platform's
  public hot path — `GET /r/{token}` on `packages/redirect` — only sees
  **clicks on tracked links**.

## 2. What reaches the hot path

Assumption: a click-through of **0.05 %–0.5 %** of views on shoppable
placements (a range chosen to bracket the unknown; no placement has served
real traffic yet).

| | 0.05 % CTR | 0.5 % CTR |
|---|---|---|
| Clicks per month | 12e9 × 0.0005 = **6 M** | 12e9 × 0.005 = **60 M** |
| Clicks per day | 200 000 | 2 000 000 |
| Average clicks/s | 4 630 × 0.0005 ≈ **2.3** | 4 630 × 0.005 ≈ **23** |
| Peak, assuming ×10 over average | ≈ **23 requests/s** | ≈ **230 requests/s** |

For scale: `docs/infrastructure-recommendation.md` costs the pilot at
"≤ 10k redirect hits/day" (10 000 / 86 400 ≈ 0.12 requests/s). The owner's
figure at the bottom of the CTR range is 20× that pilot assumption; at the
top, 200×. The recommendation's instance sizes were not chosen for this
figure.

### The existing soak gate

`scripts/load/redirect-soak.js` enforces the pre-pilot gate recorded in
`docs/pilot-checklist.md`: **500 requests/s sustained for 15 minutes, p95
< 150 ms service processing on `GET /r/{token}`, error rate < 0.1 %**
(`pnpm load:soak`; `pnpm load:smoke` is 50 rps for 30 s). 500 rps is above
the estimated peak of 23–230 rps — roughly 2× headroom at the top of the
range, 20× at the bottom — **if the gate passes**. It has never been run
against real infrastructure: the script itself says it "CANNOT run
meaningfully here" against pg-mem, and no run on a real deployment has been
recorded anywhere in this repository. Until one is, there is no measured
number for the hot path.

## 3. The hot path, component by component

### Redis route cache (the lever)

Each token's route (`destination_url`, `allowed_hosts`, programme and offer
status, `fresh_until`, `org_id`, `link_id`) is cached under `route:{token}`:
**600 s** when the API mints the link (`packages/api/src/routes/links.ts`,
`'EX', 600`) and **300 s** when the redirect rebuilds it on a miss
(`packages/redirect/src/index.ts`, `'EX', 300`). A miss costs one four-table
join in Postgres.

The useful property: misses are bounded by the number of **distinct active
tokens**, not by traffic. With an assumed 1 000 active links, the redirect
can fall back to Postgres at most 1 000 / 300 s ≈ 3.3 lookups/s no matter
how many clicks arrive, so the hit ratio climbs towards 1 as traffic
concentrates on a few links. The cache entry is a few hundred bytes of JSON;
Redis memory for it is negligible at any plausible link count. Kill-switch
staleness is the other side of the same TTL: a pause invalidates the keys
explicitly, so the 300 s / 600 s windows only matter when Redis is
unreachable (`docs/runbooks/tracking-outage.md`).

### Postgres: the `clicks` table grows with every click

The click write cannot be cached: every attributed click is one `insert into
clicks` (`id`, `org_id`, `link_id`, `click_id`, `occurred_at`, `context`
jsonb with the user agent and a SHA-256 IP hash, `created_at`) plus four
indexes (`db/migrations/0001_core.sql`: primary key, `click_id` unique,
`idx_clicks_org`, `idx_clicks_click_id`).

- At 0.5 % CTR that is **≈ 60 M rows a month** (2 M a day). Assuming
  ≈ 0.5 KB per row including indexes, that is ≈ 30 GB a month at the top of
  the range and ≈ 3 GB a month (6 M rows) at the bottom.
- The retention purge (`packages/workers/src/retention/purge.ts`) is already
  **window-based**: it nulls `clicks.context` older than
  `RETENTION_CLICK_CONTEXT_DAYS` (365-day placeholder until counsel sets the
  real window) but keeps every row, because `conversions.click_id` references
  `clicks(id)`. Rows therefore never leave the table by themselves.
- **To plan: monthly range partitioning of `clicks` on `occurred_at`** (a
  new migration; migrations are append-only). Partitioning lets the purge
  and any future archival work per month instead of scanning a table of
  hundreds of millions of rows, and lets `idx_clicks_org` stay small per
  partition. The `click_id` unique constraint would have to include the
  partition key or move to an application-level guarantee; that is a schema
  decision for `db/`, not made here.
- Connections: each redirect replica opens a pool of up to **20**
  connections (`max: 20` in `packages/redirect/src/index.ts`), the API the
  same (`packages/api/src/db.ts`). Postgres 16's default `max_connections`
  is 100, so more than three redirect replicas beside the API and workers
  need a pooler (PgBouncer) or a raised limit.

### Redirect replicas and fail-open

The redirect service is **stateless**: Redis and Postgres hold all state, so
replicas can be added behind the proxy without coordination (the fleet's
root `docker-compose.yml` runs one `affiliate_redirect`; scaling it is a
`--scale` or a second host, and the connection arithmetic above applies).

Its documented **fail-open** behaviour (`packages/redirect/README.md`): if
the click insert or the queue add fails, the shopper is still 302'd to the
approved merchant destination, **without** a `subid`, and the loss is logged
(`click persistence failed; redirecting without click_id (event loss)`).
Under overload this is what degradation looks like — revenue flow continues,
attribution silently drops — which is why the primary detection signal is
click volume, not errors (§5). Eligibility failures (paused programme, stale
offer) serve the paused page with HTTP 200, and an unapproved destination
host is refused with 403 (fail closed).

### BullMQ `click-events` queue

Every persisted click also enqueues one `click.observed` job
(`removeOnComplete: 1000`, `removeOnFail: 5000`, so completed-job history in
Redis is bounded). The worker (`packages/workers/src/workers/click-events.ts`)
verifies the payload hash and logs; it does no database work, so its
throughput is bound by Redis, not Postgres. At the estimated peak of 230
jobs/s the queue is well within a single Redis, but a stalled worker lets
the backlog grow without bound — the fleet compose runs Redis with
`--appendonly yes`, so a backlog also costs disk. Aggregation into analytics
is still a TODO in that worker; when it lands it will add per-click
database work and must be sized then.

## 4. The consumer web (`packages/web`)

- Every catalogue fetch carries `next: { revalidate: 60 }`
  (`REVALIDATE_SECONDS = 60` in `packages/web/lib/catalogue.ts`), so the
  API sees at most one list call and one detail call per look per 60 s per
  web replica, whatever the page traffic.
- Pages render on demand (`dynamic = 'force-dynamic'`), so **HTML render
  CPU scales with page views**, not with the 60 s data cache. Next's default
  `Cache-Control` for dynamic routes is a no-store value, so a CDN in front
  of the shop needs explicit cache headers before it can absorb anything;
  that is not done. The infrastructure recommendation says "no CDN at pilot".
- Target from the pilot checklist: **p75 LCP ≤ 2.5 s** on the PWA. Nothing
  has measured it. Cover images are plain `<img>` tags from
  `assets.public_url`; the fleet seed's cover assets are storage keys
  (`demo/fleet/<key>.jpg`), so on the seeded shop `cover_url` is null, the
  gradient placeholder renders, and there is no image LCP element to
  measure yet.
- The shop's own token is server-side only (`WEB_API_TOKEN`) and the
  `/api/*` proxy adds one hop for the app areas' browser calls; the proxy is a
  per-request route handler and shares the web process's CPU.

## 5. Alerts already defined (none wired)

`docs/monitoring/alerts.yaml` is marked "DEFINED, NOT WIRED". The alerts
that matter for capacity:

| Alert | Threshold | Window | Severity |
|---|---|---|---|
| `click-volume-drop` | drop > 50 % vs the same weekday-hour 4-week baseline; pilot floor < 10 clicks/10 min during 08:00–23:00 IST | 10 m | critical |
| `redirect-5xx-rate` | > 1 % over 5 minutes | 5 m | critical |
| `redirect-p95-latency` | p95 > 500 ms sustained | 10 m | warning |
| `redirect-canary-failure` | ≥ 1 failed hourly probe | 1 check | critical |
| `webhook-event-backlog` | lag > 30 min or ingestion 5xx > 1 % | 15 m | warning |
| `books-balanced-sweep` | any ledger imbalance | 1 h | critical |

Two consequences of the figure in §1: the pilot floor of "< 10 clicks per
10 minutes" is far below the low estimate (2.3 clicks/s ≈ 1 380 per 10
minutes) and would need re-tuning on day one, and the `click-volume-drop`
alert is the one that detects fail-open loss, so it must be wired before
any real placement carries traffic (`docs/ASSUMPTIONS.md` §2–3).

## 6. What the fleet's Linode can host

The fleet runs on one **4 GB Linode** (`g6-standard-2`, `infra/linode/
provision.sh`). Its root `docker-compose.yml` already keeps eleven
containers up — `proxy`, `acme`, `db` (MariaDB), five WordPress sites,
`autopub`, `openseo`, `pulse_worker` — and the `affiliate` profile adds six
long-lived ones (`affiliate_db` Postgres 16, `affiliate_redis`,
`affiliate_api`, `affiliate_redirect`, `affiliate_workers`, `affiliate_web`)
plus the one-shot `affiliate_migrate`. No service sets a memory limit.
Assuming ≈ 150 MB resident per Node service, the four Node services take
≈ 600 MB before Postgres (default `shared_buffers` 128 MB plus connections)
and Redis; nothing has been measured on the host.

Verdict: the Linode is a **pilot host** — it is where the first real
placements, the smoke test and the soak can run against real Postgres and
Redis on the same box as the sites that send the clicks. It is not the
production shape: that is `docs/infrastructure-recommendation.md` (managed
Postgres and Redis, separate compute, a load balancer, monitoring), and the
20×–200× gap between that document's pilot assumption and the owner's
figure means its instance sizes must be revisited with a measured CTR in
hand, not extrapolated from this page.

## 7. What we do not know yet

- The real click-through on a shoppable placement (no placement has served
  real traffic; 0.05 %–0.5 % is an assumption).
- How much of the 12 billion is web page views versus social impressions
  that cannot carry a clickable tracked link.
- The bot and crawler share of hits on `/r/{token}` (each is a `clicks`
  row today; there is no rate limiting on the redirect — open in
  `docs/pilot-checklist.md`).
- The Redis hit ratio and the Postgres insert latency on the Linode's disk
  under load (the soak has never run).
- The web's render cost per page and whether nginx-proxy in front of it
  adds measurable latency.
- Whether a CDN will front the shop, and with what cache headers.
- Counsel's retention windows: the 365-day placeholder for `clicks.context`
  sets the table's size as much as traffic does.
- Whether the soak gate (500 rps, p95 < 150 ms, error rate < 0.1 %) passes
  at all on the fleet host.
