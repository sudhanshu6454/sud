# Capacity plan — Afflino's hot path at the owner's audience figure

Dated 2026-09-29. Status: **a plan built on one owner-supplied figure and
stated assumptions; nothing in it has been measured on real traffic.**
Every number below is either quoted from a file or test output in this
repository, or arithmetic from an assumption named in the same sentence.

## 1. The input figure

The owner's figure is **about 12 billion views a month**. The owner's words
were "our in-house views of 12b monthly" and, on 2026-09-29, "we have
publisher traffic in house from instagram, facebook and snapchat and
youtube": the views are **social views on the owner's own accounts** on
those four platforms, not web page views. Nothing in this repository counts
views; the owner's figures are the source.

The owner's Meta export of 2026-09-28 (28 days, data through 2026-09-27;
the files are not in this repository, and neither is the network file
built from them, which lives on the server as `/etc/afflino/network.yaml`)
bears the figure out for Facebook and Instagram alone:

| Platform | Accounts | Views, 28 days |
|---|---|---|
| Facebook | 322 pages | 9 564 778 510 |
| Instagram | 82 accounts | 2 385 360 240 |
| **Meta total** | 404 | **11 950 138 750** (≈ 12.8 billion per 30 days) |

Snapchat and YouTube come on top; their account lists had not arrived. The
arithmetic below keeps the round 12 billion a month.

Arithmetic on it:

- 12 000 000 000 / (30 × 86 400 s) ≈ **4 630 views/s** on average.
- Views are not the platform's load. Many of them are impressions on posts
  that carry no clickable link, and a tracked link is only clicked where a
  placement renders one: for example the bio link and story link stickers on
  Instagram (captions and reels carry no clickable link), links in Facebook
  posts, Snapchat link stickers, and YouTube video descriptions (Shorts
  descriptions are not clickable). The platform's public hot path — `GET /r/{token}`
  on `packages/redirect` — only sees **clicks on tracked links**.

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
replicas can be added behind the proxy without coordination
(`docker-compose.prod.yml` runs one `redirect`; scaling it is a `--scale` or
a second host, and the connection arithmetic above applies).

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
the backlog grow without bound — with Redis persistence on (AOF or
snapshots, a managed-Redis setting), a backlog also costs disk. Aggregation into analytics
is still a TODO in that worker; when it lands it will add per-click
database work and must be sized then.

### Amazon.in Associates (2026-09-29)

What the integration adds to the numbers above, all bounded by Amazon's own
limits rather than by traffic:
- **The redirect**: per Amazon click, one user-agent regex (link-preview
  crawlers get a preview page, no `clicks` row) and a query-string rewrite
  of the destination; no extra query on a cache hit. Crawler hits on Amazon
  links therefore no longer grow `clicks`.
- **Links**: one row per (page with its own tracking ID) × product. Amazon
  caps tracking IDs at 100 per account, so at most 100 × the ASIN count
  (100 × 500 ASINs = 50,000 `links` rows, 50,000 possible `route:*` keys,
  each written only when its link is minted or first clicked). Minting runs
  one `POST /v1/links` per new pair, in process (`amazon.sh links`).
- **Prices**: the workers' hourly job asks Amazon's Creators API for at most
  300 requests × 10 ASINs per run (`AMAZON_REFRESH_MAX_REQUESTS`), at least
  1.1 s apart, oldest price first; a price is shown for **one hour** (the
  Creators API's "Offers | 1 hour", stricter than OA §11's 24 hours,
  `AMAZON_PRICE_MAX_AGE_HOURS`). While Amazon's starting allowance holds —
  "one request per second (one TPS) and a cumulative daily maximum of 8640
  requests per day", i.e. 360 requests an hour — at most ~3,000 ASINs (300 ×
  10) keep a price at any time; the rest show "See price on Amazon.in". A
  run takes up to ~6 minutes at 1.1 s per request, so the last ASINs of a
  run can go priceless for a few minutes before they are re-read.
  **That allowance lasts 30 days.** Amazon: "8640 TPD for the first 30-day
  period"; after it, "one TPD for every five cents or one TPS (up to a
  maximum of ten TPS) for every $4320 of shipped item revenue generated via
  the use of Creators API", with "For correct attribution of shipped item
  revenue please ensure that you … retain all the URL parameters that the
  API returns" and "Do not edit any of the URL parameters". This build does
  not use the API's links: it redirects to `/dp/<ASIN>?tag=<the page's
  tracking ID>` (one link per page, the tag the only attribution; the API's
  links are made for one partner tag per call). So the shipped revenue that
  earns API allowance will be about zero, and **prices will likely stop
  after the first 30 days**: the allowance collapses, calls answer `429
  ThrottleException`, and the shop falls back to "See price on Amazon.in"
  (links and conversions are unaffected). The workers do not hammer it: a
  429 pauses the account's refresh until the error's `retryAfterSeconds`,
  else until the next UTC day (Amazon does not say when its day starts); a
  401 / 403 (e.g. `AssociateNotEligible` after 30 days without referred
  sales) until the next UTC day (`amazon_associates_accounts.api_paused_until`).
  Keeping prices would mean switching to the API's own links (GetItems per
  tracking ID, the vended `detailPageURL` cached for at most a day and
  redirected to unmodified) — an owner / engineering decision
  (`docs/action-tracker.md`, "Product API access").
- **Reports**: one monthly Earnings download, aggregated per item and day by
  Amazon; the API route caps a report at 2 MB (`MAX_REPORT_BYTES`), the CLI
  reads the file whole. Unmeasured: the size of a real month's download for
  the in-house network (no sample yet).

### Celebrity looks (2026-09-30)

What 0007 adds, none of it on the `/r/` hot path except one column:
- **The redirect**: its route query now selects `links.status` too (a paused link serves the
  paused page); no extra query, no extra key. A takedown or a rights change deletes the
  affected links' `route:*` keys after its commit and again 2 s later, like the kill switch.
- **The public read API** (`/v1/public/{org}/…`): no token, `Cache-Control: public,
  max-age=30`, pages of at most 48 cards; the read gate is part of every query (a join on the
  celebrity, the takedown, the display level), so a look page costs a handful of indexed
  queries (look, celebrity, pieces, items, live offers, links) plus one for the
  organisation's celebrity names (the name check). Since the reviews of 2026-09-30 the api
  keeps each answer 30 s per process (1000 URLs) under a Redis epoch every invalidation
  increments, so a takedown drops them at once; stills the same within 64 MB (one origin
  fetch per look per 30 s per process). A visitor is limited to `PUBLIC_RATE_PER_MINUTE`
  (240) requests a minute per api process, by the address the edge saw; the web's own
  server-side calls are not counted (they are bounded by the web's caches, below). Many
  phones behind one carrier NAT address share one allowance — only the browser's own `/api`
  calls count, and the shop's pages make none for the celebrity pages, so this bites only
  direct API readers; measure before raising it. Unmeasured: the look page's latency under
  load.
- **The Meta webhook**: one insert per matching comment (`on conflict (platform, comment_id) do
  nothing`), a 5 MB body cap, the signature checked before any parse, `WEBHOOK_RATE_PER_MINUTE`
  (1200) per sending address and api process (Meta retries a refused delivery). A viral post's comment
  burst lands as rows; sending is decoupled.
- **Comment replies**: a sweep every `COMMENT_REPLIES_SWEEP_MS` (5 s) enqueues up to 200
  ready events per run; each send is one Graph call. Meta's send limits apply and are not
  measured here: a rate-limit error (codes 4 / 17 / 32 / 613) backs the event off, and events
  older than Meta's 7-day private-reply window expire unsent. At 200 per 5 s the ceiling is
  ≈ 144,000 sends a day before Meta's own limits.
- **Rollups**: hourly (`ANALYTICS_ROLLUP_CRON`, `7 * * * *`), recomputing the last 2 IST days
  of clicks and 8 of replies into `click_daily` / `reply_daily` with upserts (only days inside
  the retention windows); the scan is bounded by `idx_clicks_org_occurred`. At the §2 click
  rates that is up to ~2 days of `clicks` rows read per run per organisation: to be measured
  before real traffic. A review's probe: 1,000,000 TEST clicks over 30 days rolled up exactly
  (every day's count equal), the 2-day hourly run in 440 ms, an index scan at 48 ms a day.
- **Analytics** (`GET /v1/analytics/clicks`): summed in SQL (`sum(clicks) … group by` the
  chosen key over `click_daily`, up to 366 days), so the api holds one row per group, not
  one per link and day.
- **Growth**: `reply_events` is purged after 30 days (placeholder); `click_daily` grows by
  (links clicked per day × surfaces), `takedowns` and `celebrity_rights_reviews` are kept.
- **The web's celebrity pages** (stage 2): every public fetch is `revalidate: 30` with cache
  tags, per web process, so the API sees at most one call per distinct URL per 30 s per
  process — the feed per filter combination (a celebrity, a page, a page number: bounded by
  the facets and the page count), a look, a hub, a storefront, the trending row, the sitemap.
  A takedown clears the affected tags at once (`/internal/revalidate`) instead of waiting.
- **The middleware** (`/looks/*`, `/c/*`): one HEAD to the public API per page per 5 s per web
  process while it is not withdrawn (30 s once it is), at most 5,000 remembered pages per
  process (the map is cleared whole when full). A crawler walking many look ids costs one
  HEAD per id (a uuid lookup through the read gate) plus the page's own fetch; not rate
  limited (the web's own calls are not counted; no limit at the edge).
- **Trending**: one call per 30 s per web process; the API reads the last 7 days of
  `click_daily` for the organisation joined to `links` and `look_items`, ranks in memory and
  re-reads at most 12 cards through the read gate. The rows read grow with (links clicked per
  day × 7); to be measured once real clicks exist.
- **The library import**: the file is read whole and checked in full before anything is
  written (one advisory lock per organisation); the admin's upload caps `csv_text` at 900,000
  characters (roughly 2,500 rows of the example's width), larger files go through
  `looks.sh import`. Unmeasured: the owner's real library size (not in the repository).
- **Comment bursts**: a viral post's keyword comments queue as rows; the sweep's ceiling of 200
  sends per 5 s (2,400 a minute) is above what Meta's own messaging limits are likely to allow
  per account (not measured, not documented here as a number); the private-reply window of 7
  days is the backlog's hard bound. A comment on a post whose look was taken down queues
  nothing.

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
  `assets.public_url`; the network seed's cover assets are storage keys
  (`demo/network/<key>.jpg`), so on the seeded shop `cover_url` is null, the
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

## 6. Where it runs

Nothing is provisioned. The deployment shape is `docker-compose.prod.yml`
(api, redirect, workers, web and the one-shot migrate against managed
Postgres and Redis), and the hosting proposal — AWS ap-south-1 or
DigitalOcean blr1, managed Postgres and Redis, separate compute, a load
balancer, monitoring — is `docs/infrastructure-recommendation.md`, which
still needs the owner's approval. Its instance sizes were chosen for
"≤ 10k redirect hits/day"; the 20×–200× gap between that assumption and the
owner's figure (§2) means they must be revisited with a measured CTR in
hand, not extrapolated from this page. No service in
`docker-compose.prod.yml` sets a memory limit; assuming ≈ 150 MB resident
per Node service, the four Node services take ≈ 600 MB per host before any
headroom, and nothing has been measured.

## 7. What we do not know yet

- How the views split across Snapchat and YouTube (the Meta split is in §1),
  and what share of each platform's posts will carry a tracked link.
- The real click-through on a shoppable placement (no placement has served
  real traffic; 0.05 %–0.5 % is an assumption).
- The bot and crawler share of hits on `/r/{token}` (each is a `clicks`
  row today; there is no rate limiting on the redirect — open in
  `docs/pilot-checklist.md`).
- The Redis hit ratio and the Postgres insert latency under load on the
  chosen hosting (the soak has never run; the owner has chosen a single
  Linode, where Postgres, Redis and the services share one machine).
- The web's render cost per page and whether the load balancer or reverse
  proxy in front of it adds measurable latency.
- Whether a CDN will front the shop, and with what cache headers.
- Counsel's retention windows: the 365-day placeholder for `clicks.context`
  sets the table's size as much as traffic does.
- Whether the soak gate (500 rps, p95 < 150 ms, error rate < 0.1 %) passes
  at all on the infrastructure that is eventually provisioned.
