# CLAUDE.md — Paparazzi Affiliate Commerce Platform

India-first affiliate commerce platform (INR, mobile-first web/PWA, merchant-owned
checkout). This repo is a **sandbox-complete** implementation: the full money loop
works end to end against stubbed integrations. No real merchant credentials, no
production secrets, no real money movement.

The web app is **Afflino**, a standalone website and app with its own stack
(`docker-compose.prod.yml`), its own CI workflow (`.github/workflows/afflino.yml`
at the repository root) and its own in-house publisher network, seeded from a
network file (`db/seed-network.ts`, default `db/network.example.yaml`, TEST data).
Everything here runs from this directory; nothing outside it is needed.

## Verified state (2026-09-29)

- `pnpm typecheck` clean on all 5 packages (`packages/*`)
- **788/788 tests green across 46 test files** (`./node_modules/.bin/vitest run`:
  api 203, redirect 10, shared 28, workers 24, web 523; re-run 2026-09-29 after
  the Amazon review fixes)
- Demo: **51/51 assertions** on pg-mem (`tsx scripts/demo-money-loop.ts`) **and
  51/51 on a real PostgreSQL 16.13** (`DEMO_TARGET=postgres`, scratch database
  `paparazzi_demo_<8 hex>` created and dropped, no shims) — link → click →
  conversion → attribution → ledger posting → 50% reversal → payout batch →
  maker-checker → payout, **including payout-failure handling** (unknown outcome →
  blind retry refused 409 → status query → informed retry → paid, no double payout)
- **Amazon report imports under concurrency, on real PostgreSQL 16.13**
  (`pnpm race:pg`, `scripts/amazon-import-race.ts`, scratch database
  `paparazzi_demo_race_<8 hex>` created and dropped; also in CI): 10 rounds × 6
  concurrent return files against one 160.00 sale reverse exactly 16000 paise
  each (before the fix: up to 5×), the publisher's liability on them 0, never
  below; 10 concurrent pairs of one row at 160.00 vs 999.00 give exactly one
  202 and one 409 each (before: both accepted in 9 of 10); books balanced
- Migrations `0001`–`0006` apply on a fresh Postgres 16 and are recorded in
  `schema_migrations`; a second run is a no-op (`0 migration(s) applied, 6 already
  applied`); `--status` and `--baseline` work; `0006_amazon_associates.sql` also
  applies on top of a database migrated to 0005 and seeded like production
  (`1 migration(s) applied, 5 already applied`, every row count unchanged, a
  second network seed byte-identical; re-run after the review fixes)
- `db/seed.ts` and `db/seed-network.ts --with-demo-programme` run on real Postgres;
  the network seed is idempotent (identical row counts and byte-identical JSON on
  a second run), keeps operator status changes, and refuses (rolling back) to take
  over another organisation's property or placement
- The owner's real in-house network (the Meta list of 2026-09-28: 322 Facebook
  pages, 82 Instagram accounts; the file is not in this repository, it goes to
  the server as `/etc/afflino/network.yaml`) seeds with `NODE_ENV=production`
  through the documented lines (`docs/runbooks/deploy.md`, "The in-house
  network": the Meta exports copied to the server, `db/meta-network.ts`
  builds the file there, the seed reads it): 404 approved properties plus
  the shop's own, identical output on a second run, rehearsed on scratch
  Postgres 16 and on the installer's stack in test mode
- `pnpm install --frozen-lockfile` passes (pnpm 9.12.0 locally, in CI and in the
  images)
- `pnpm --filter @paparazzi/web build` OK (all routes dynamic, standalone output);
  on the build (`next start`) all 36 routes of the web route map answer 200, the
  110 internal links they render resolve (200 or an intended 307), every page
  that shows TEST data carries the "Demo data" badge, no page requests Google
  Fonts, names a real merchant from the design mocks or mentions a cookie
- The five images (`docker/Dockerfile.{api,redirect,workers,web,migrate}`) build
  (`--no-cache`: 264 / 270 / 255 / 269 / 262 MB; the web image is 273 MB after
  the Afflino rebuild) and boot end to end: migrate → seeds → `/healthz` on api,
  redirect and the web proxy → `/` titled "Afflino", `/shop` renders the five
  TEST network looks live → `mint-links.mjs` mints → the look page carries the
  tracked link → `GET /r/{token}` → 302 with `subid`, no `set-cookie` → one
  `clicks` row → workers log `click.observed` (`docker/README.md`, smoke test,
  re-run 2026-09-29 with the network seed, again through the edge, again
  after the review fixes with the 413 and upstream-down 502 probes, and again
  verbatim after the Amazon review fixes, every observed line unchanged)
- **Production deploy shape for afflino.com** (2026-09-29): the edge
  (`caddy:2-alpine` + `docker/Caddyfile`) is the only public listener;
  `docker-compose.prod.yml` + `docker-compose.single-host.yml` (Postgres 16 +
  Redis 7 on the host) rehearsed end to end locally with the edge in
  plain-HTTP mode (`docker-compose.edge-test.yml`, 127.0.0.1:8088) and in
  HTTPS mode with Caddy's internal CA: canonical / og:url on
  `https://afflino.com`, both `SITE_INDEXING` states, www → apex 301 with
  path + query, HTTP → 308, `/r/<token>` 302 with `subid` and no cookie, a
  spoofed X-Forwarded-For leaving `ip_hash` = HMAC(`IP_HASH_KEY`, the address
  the edge saw), the kill switch's atomicity on real Postgres, teardown clean
  (README.md "Deploying afflino.com", `docs/runbooks/deploy.md` §1R). The
  edge's own errors (502 with an upstream down, 413, `CONNECT`) carry the
  security headers and no `Server` (`handle_errors`; over HTTP and HTTPS);
  only Caddy's port-80 → HTTPS 308 says `Server: Caddy`.
  **afflino.com is live** on the owner's Linode, 172.105.52.150 (the owner's
  word, 2026-09-29): DNS at GoDaddy points `A @` there, the owner ran the
  installer, and at 17:20 UTC the site answered over HTTPS with Let's
  Encrypt certificates for afflino.com and www (checked from outside
  against f7046bd; later commits reach it when the owner re-runs the line).
- **The Linode installer** (2026-09-29, `deploy/linode/`): `install.sh`
  (one line, `bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)`,
  install = update: preflight (root, the OS, a server of its own: refuses
  other Docker compose projects and held ports), system, sparse checkout
  `/opt/afflino` (the release before kept as the git tag
  `afflino-previous`, the rollback point of `docs/runbooks/deploy.md` §3;
  the rest of the run re-executes the checkout's own `install.sh`, because
  the curl'd copy can lag a push by 5 minutes), `/etc/afflino/afflino.env`
  0600 with generated secrets, `compose build` → the migrations on their
  own (a failure recreates nothing) → `up -d`, health, DNS status, daily
  backup timer), `backup.sh` / `restore.sh` (pg_dump / psql inside the
  postgres container; restore check with the ledger-balance check;
  `--replace-live` clears the redirect's `route:*` cache), `godaddy-dns.sh`
  (optional, `A @` + `AAAA @`; a personal access token → `Bearer`, or key +
  secret → `sso-key`, at two hidden prompts). ShellCheck 0.11.0 / 0.9.0
  clean; rehearsed in the sandbox with its test-only settings, last after
  the review fixes (first run through `bash <(…)` on a pty: the file
  created, a healthy stack; a second run changes nothing: same env-file
  hash and mtime, container and image ids; `/r/` 302 without a cookie, a
  spoofed X-Forwarded-For leaving `ip_hash` = HMAC(key, 127.0.0.1), www
  301, headers, both `SITE_INDEXING` states, the 502 / 413 probes; a
  failing migrate stops with every container untouched; the guard; the
  re-exec and the tag against the public repository; `--replace-live`
  clearing a cached route; `godaddy-dns.sh` against a local API stand-in),
  the system step and the guards in an `ubuntu:24.04` container earlier
  (`deploy/linode/README.md` "What was checked"). The edge uses **host
  networking** (sees real IPv4 and IPv6 client addresses, so afflino.com
  gets an AAAA record; `docker/ASSUMPTIONS.md` item 19). Not run on the
  real Linode; no real certificate, GoDaddy API call or IPv6 test.
- **Amazon.in Associates** (2026-09-29; the owner's "lets integrate amazon
  affiliate now"; re-verified after two independent reviews' fixes): built
  config-driven with TEST values only and **not on afflino.com** until the
  owner runs `docs/runbooks/deploy.md` §1A with the real account. Links
  `afflino.com/r/<token>` for the owner's own Facebook / Instagram / web
  properties only (`owner_operated`, 403 `PROPERTY_NOT_OWNER_OPERATED`
  otherwise, no setting allows third parties; Snapchat / Telegram 403
  `PROPERTY_FORBIDDEN`) → 302 to `https://www.amazon.in/dp/<ASIN>?tag=<the
  page's tracking ID>`, never a click id (no `subid`, no `ascsubtag`, no
  setting for one), no cookie, `X-Robots-Tag: noindex, nofollow`; automated
  clients (named previewers, generic bot / HTTP-library user agents, none),
  prefetches and HEAD get a preview page; the earnings download imported as
  conversions attributed by tracking ID, one import at a time per account,
  return reversals atomic, an unmatched return applied by the owner's
  choice (`returns`); the CSV / webhook adapters refuse Amazon's programme
  and account (422); the shop's Amazon copy ("Buy on Amazon.in", OA §10's
  statement always first, a price only from the product API within 1 h with
  "(as of … IST)" and Amazon's disclaimer, else "See price on Amazon.in";
  "You complete the purchase on Amazon.in; Amazon.in's terms apply.";
  "Affiliate links: Yes" on Amazon looks). The owner's steps are one line
  each (`deploy/linode/amazon.sh keys | template | setup | offers | links |
  shop | import | returns | check | pause | resume`, hidden prompts,
  ShellCheck 0.11.0 / 0.9.0 clean; `setup` turns the footer statement on;
  `links` and `shop` refuse while `/privacy` is the stub), rehearsed end to
  end on the installer's stack in test mode with the prompts fed from
  standard input, both privacy refusals shown and then skipped with the
  test-only setting (`deploy/linode/README.md` "What was checked"; what each
  step printed: `docs/runbooks/deploy.md` §1A). The backend end to end on a
  production-shaped scratch database (tsx api + redirect, Redis 7): setup
  (TEST values refused under production; Snapchat / Telegram rows and an
  "alexa" tracking ID refused) → links (6, `post_label` on each) → `/r/` 302
  `…/dp/B0DEMO0001?tag=demo-ig-21`, one click, 64-character IP hash; curl /
  python-requests / Go / HeadlessChrome / previewers / prefetch / HEAD → 200
  preview, no click → import (2 by tracking ID, 2 suspense:
  `TRACKING_ID_UNMAPPED`, `TRACKING_ID_MAPPED_AFTER_SALE`) → ledger balanced,
  11200 / 4800 at 70/30 → 3 re-imports deduped → a changed fee 409, nothing
  written → the return: IG sale at 5600 / 2400 → an ambiguous return listed,
  `apply-return` applied once (2800 off the publisher), re-run and re-import
  deduped → the CSV and webhook adapters 422 → books INR 51984 / 51984. Every
  Amazon / counsel question is open (`docs/action-tracker.md` "Amazon.in
  Associates", `docs/counsel-briefing.md` §9); nothing here is a compliance
  claim.
- The CI workflow `afflino` (`.github/workflows/afflino.yml`, runs on changes
  under `affiliate/`) runs the frozen install, typecheck, vitest, both demos, the
  web build and the real-Postgres migrate + seeds; no run has been observed from
  this sandbox; it also runs ShellCheck on `deploy/linode/*.sh`

## Commands

All from `affiliate/`. `pnpm` is `/opt/node22/bin/pnpm` in this sandbox; `tsx` is
not at the repo root, so the scripts that need it are given with the api package's
copy.

```bash
./node_modules/.bin/vitest run                                        # tests (784)
pnpm typecheck                                                        # 5 packages
./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts       # demo on pg-mem (51 assertions)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi DEMO_TARGET=postgres ./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts   # same demo on real Postgres (scratch DB, dropped)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx scripts/amazon-import-race.ts   # Amazon imports under concurrency (pnpm race:pg; scratch DB, dropped)
docker compose up -d postgres redis                                   # real Postgres + Redis (dev machine)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs             # apply pending migrations
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs --status    # applied / pending
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs --baseline  # once, for a DB migrated before tracking existed
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed.ts                                  # demo graph
WEB_HOST=shop.example.com DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed-network.ts --with-demo-programme   # in-house network (example file) + shop property + TEST programme
pnpm --filter @paparazzi/web build                                    # Next standalone build
node scripts/load/redirect-soak.js --smoke                            # load smoke (needs a real deployment for meaning)
JWT_SECRET=ci STUB_WEBHOOK_SECRET=ci POSTGRES_PASSWORD=ci docker compose -f docker-compose.prod.yml -f docker-compose.single-host.yml config -q   # compose check (as CI)
shellcheck deploy/linode/*.sh                                         # the Linode scripts (CI; 0.11.0 and 0.9.0 were run by hand for the 2026-09-29 changes)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx packages/api/src/cli/amazon.ts status   # the Amazon operator CLI (setup | offers | template | links | import-report | returns | apply-return | status | pause | resume)
```

The owner's one line, as root on the Linode (install and every update;
the rest of the procedure: `docs/runbooks/deploy.md`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
```

Rehearse it off the Linode only with its test-only settings
(`AFFLINO_SKIP_SYSTEM=1 AFFLINO_SKIP_GIT=1 AFFLINO_EDGE_TEST=1`, a
throwaway `AFFLINO_PROJECT`, scratch `AFFLINO_ENV_FILE` /
`AFFLINO_BACKUP_DIR`; in this sandbox an `AFFLINO_EXTRA_COMPOSE_FILE`
with `NODE_IMAGE: local/node22-alpine-ca` build args), then `down -v`.

Notes: `pnpm demo`, `pnpm demo:pg`, `pnpm race:pg`, `pnpm seed`, `pnpm seed:network` call the api
package's `tsx` (`./packages/api/node_modules/.bin/tsx`); the root has none.
`pnpm install --frozen-lockfile` **works** (the earlier "known-broken" note is
obsolete; CI runs it). `packageManager` pins pnpm 9.12.0 and the Dockerfiles'
`PNPM_VERSION` default is the same version. Vitest runs against
**pg-mem**; the real-Postgres proofs are `DEMO_TARGET=postgres`, the migrate/seed
runs and the docker smoke test.

## Architecture

- `packages/shared` — ledger math, error-code contract, money types. Single source
  of truth for financial invariants.
- `packages/api` — Fastify v1 API. `src/conversion-ingest.ts` is the **one money
  path**: webhook (`routes/integrations.ts`) and CSV upload
  (`routes/csv-uploads.ts`) are thin adapters over `ingestConversionEvent`.
  `src/finance.ts` (ledger posting), `src/payout-rail.ts` (fake rail + unknown-
  outcome guard), `src/idempotency.ts`. `scripts/mint-dev-token.mjs` (JWT stub)
  and `scripts/mint-links.mjs` ship in the api image. **Amazon.in Associates**
  (`src/amazon/`, 2026-09-29): the Amazon earnings report
  (`routes/amazon-reports.ts`, `POST /v1/integrations/amazon-associates/reports`,
  and the CLI's `import-report`) is a third thin adapter over the same money
  path (`src/amazon/report-format.ts` the column table, layout to confirm with
  a real export; `report-import.ts`: one import at a time per account, a
  session advisory lock; returns reversed atomically,
  `insertReversalWithinRemainder`; unmatched returns applied by the
  operator's choice, `src/amazon/returns.ts`); the CSV and webhook adapters
  refuse the Amazon programme and account (422); attribution by tracking ID
  (`resolveAttribution` in `conversion-ingest.ts`: the ONE placement the ID is
  mapped to, the mapping older than the sale; `conversions.placement_id`,
  never with `click_id`); the ledger walks placement → campaign → publisher
  with the same contract lookup and snapshot as a click (`finance.ts`).
  `src/cli/amazon.ts` (`dist/cli/amazon.js` in the image: setup, offers,
  template, links, import-report, returns, apply-return, status, pause,
  resume; `links` and the kill switch go through the API's own routes
  in-process, `src/amazon/links.ts`).
- **Catalogue endpoints** (`routes/looks.ts`, the consumer shop's read path):
  `GET /v1/looks` (published, paginated; each item carries `source_page`,
  `sponsored`, `cover_url`, `item_count`) and `GET /v1/looks/:id?placement_id=`
  (items with product, variant, the **live offer** = `offers.status='active' AND
  fresh_until > now() AND programmes.status='active'`, cheapest wins, and — only
  with a `placement_id` — the existing active `links` row as `{token, url}`).
  `offers.offer_url` is never selected; the consumer only ever gets the tracked
  `/r/{token}` URL or `null`. The offer carries `connector`, and a programme
  with a price age limit (Amazon: 1 h) returns `price_minor` / `price_as_of`
  only for a product-API price inside it, else null and `stock_status`
  `unknown` (`src/offer-price.ts`). Visibility is 404-only: another org's look, a
  non-published look for any role but `editor`/`network_admin`, and a
  `placement_id` outside the org are all `404 NOT_FOUND`. `url` is built by
  `src/redirect-url.ts` (`REDIRECT_BASE_URL` + `/r/` + token), shared with
  `POST /v1/links`. Tests: `test/catalogue.test.ts`.
- `packages/redirect` — standalone `GET /r/{token}` click service. Persists click
  records binding `click_id → placement`; sets **no cookies**; for an Amazon
  programme it strips `tag` / `ascsubtag` / `subid`, sets `tag` to the
  placement's tracking ID (else the store ID) and never adds a click id,
  answers automated clients, prefetches and HEAD with the preview page,
  serves the paused page for a disabled account or a property that is not
  approved, not owner-operated or not on Facebook / Instagram / web, and
  `X-Robots-Tag: noindex, nofollow` on every `/r/` response; Redis route cache
  (600 s on mint, 300 s on rebuild; the kill switch deletes a programme's
  entries after its commit and again 2 s later, `routes/programmes.ts`);
  fail-open (302 without `subid` if the click
  cannot be persisted). The client address is `req.ip` under `TRUST_PROXY`
  (`packages/shared/src/trust-proxy.ts`; unset = trust nothing; production
  compose `loopback,uniquelocal`, behind the edge that overwrites
  X-Forwarded-For) and is stored only as `ip_hash` = HMAC-SHA256(`IP_HASH_KEY`,
  ip) — plain SHA-256 when the key is unset (reversible for IPv4, so the key
  belongs in production). Neither the redirect's nor the api's request log
  records the address (`requestLogFields`). Under `NODE_ENV=production` api,
  redirect and workers refuse to boot without `REDIS_URL`.
- `packages/workers` — BullMQ workers: click events, provider events, ledger
  mirror, outbox, suspense retry, retention purge (`src/retention/`), and the
  hourly Amazon price job (`src/amazon/`: drops prices older than 1 h; with
  Creators API credentials, `AMAZON_CREATORS_*`, refreshes them, backs off on
  429 / 401 / 403, reactivates an offer Amazon lists again).
- `packages/web` — Next.js 14.2, the **Afflino** web app built to the design
  handover (tokens `app/globals.css`, self-hosted Archivo, primitives
  `components/ui`, shells `components/shell`; route map with artboard ids and
  live / demo status in `packages/web/README.md`): marketing site `/` (+
  `/login` dev sign-in, `/terms`, `/privacy`, `/contact` stubs), onboarding
  `/join`, creator app `/app/*` (overview, offers, links, reports, payouts +
  disputes + statements, settings), brand workspace `/brand/*`
  (`?workspace=<client id>` for an agency), agency `/agency`, admin
  `/admin/*` (review queue, brands, creators, offers, fraud, settlements,
  suspense, looks), and Afflino's **consumer shop** `/shop`,
  `/looks/[id]`, `/looks/[id]/items/[itemId]`, `/saved` live against the
  catalogue API. Live v1 calls from the app areas: `GET
  /v1/publisher/earnings`, `POST /v1/links`, `GET`/`POST /v1/disputes`,
  `GET /v1/suspense` + retry / review, `POST /v1/publishers`; everything
  else is TEST data (`lib/demo/*`) with `<DemoBadge />`. Without a token
  those pages make no call; "Demo data — API unreachable" means only that
  the API could not be reached, and any answer it gave (401 / 403 / 404 /
  400 / 5xx) is a Banner naming it (`lib/api.ts` `fallbackNotice`). Old `/portal/*` and
  `/console/*` URLs 307 to their new routes. Marketing figures, prices,
  fees, TDS, the validation window and the minimum withdrawal in
  `lib/site-copy.ts` are the owner's, **confirmed 2026-09-29** and pinned by
  `test/site-copy.test.ts`; the #ad line's wording still waits for counsel.
  The look / item pages of demo and TEST-labelled looks are always
  `noindex, nofollow` (`shopDetailMetadata`). **Web contract:** `API_BASE` (server runtime; default `http://localhost:3000`),
  `WEB_API_TOKEN` (server-only bearer for a read-only `publisher_analyst`; never
  `NEXT_PUBLIC_`, never sent to the browser, missing → TEST demo data with a
  badge), `WEB_PLACEMENT_ID` (uuid appended as `placement_id` so items carry
  their links), `NEXT_PUBLIC_API_BASE` (browser, build-time; default `/api`),
  `NEXT_PUBLIC_SITE_NAME` (runtime), `SITE_URL` (runtime; default
  `https://afflino.com`: metadataBase, canonical, og:url, robots.txt, sitemap),
  `SITE_INDEXING` (runtime; exactly `on` opens robots.txt + the sitemap of
  `/`, `/shop` and the live non-TEST looks; anything else — the default —
  keeps search engines out: `Disallow: /`, an empty sitemap, noindex on
  every page, until the owner turns it on; web ASSUMPTIONS.md items 74–78). `/api/[...path]` is a per-request proxy to
  `API_BASE` (not a `rewrites()` entry — those are frozen at build). Every
  catalogue fetch is `revalidate: 60`; pages are `force-dynamic`. The merchant CTA
  is `<a href="{link.url}" rel="sponsored nofollow noopener">` or a visibly
  disabled control; no raw merchant URL exists in the bundle. Amazon offers
  (`offer.connector`, `components/shop/model.ts` `offerCopy`; web
  ASSUMPTIONS 79–85): "Buy on Amazon.in", OA §10's Associate statement near
  the CTA, "See price on Amazon.in" or the API's price with "(as of … IST)" and
  Amazon's disclaimer / attribution line (`lib/site-copy.ts` `AMAZON_IN`: Amazon's
  own text pinned; the labels, the purchase note and the look's "Affiliate
  links" fact drafts pending counsel); the statement always first (an
  operator's disclosure only after it); no Amazon price in the wishlist;
  `AMAZON_ASSOCIATE=on` (runtime, set by `amazon.sh setup`) puts the
  statement in every footer; robots.txt disallows `/r/`; `/privacy` is a
  `StubPage` (`data-document-status="stub"`), which `amazon.sh links` /
  `shop` refuse to go past.
- `db/migrations/` — `0001_core.sql` → `0006_amazon_associates.sql` (the
  Associates account — no sub-tag or third-party column — tracking ID → one
  placement, nullable / time-limited offer prices with `stale_reason`,
  `conversions.placement_id`; 0006 was edited in place during review before
  it was ever committed or applied outside scratch databases), append-only;
  `db/migrate.mjs` records files in `schema_migrations` (`--status`,
  `--baseline`); `db/seed.ts` (demo graph), `db/seed-network.ts` (the in-house
  publisher network from a network file — `--network` / `NETWORK_FILE`, default
  `db/network.example.yaml` (six TEST properties); platforms instagram |
  facebook (by page ID or handle) | youtube | snapchat | telegram | web;
  `db/meta-network.ts` builds a real network file from the owner's Meta
  channel exports, on the server only;
  `WEB_HOST` adds the shop's own property;
  `--with-demo-programme` adds the TEST programme, one look per property and the
  placements; under `NODE_ENV=production` the seed refuses both the flag and the
  example network file).
- `docker/` — five Dockerfiles that build and boot, and `docker/Caddyfile` for
  the edge (the `security_headers` snippet on every response and in
  `handle_errors`; `docker/README.md`, `docker/ASSUMPTIONS.md`).
  `docker-compose.prod.yml` (project `afflino`: edge, api, redirect, workers,
  web, migrate; only the edge listens publicly — host networking, reaching
  redirect and web on 127.0.0.1:3001 / 3002 — the rest on 127.0.0.1) +
  `docker-compose.single-host.yml` (Postgres + Redis on the host) is the shape
  for the owner's Linode; the prod file alone takes managed `DATABASE_URL` /
  `REDIS_URL`; `docker-compose.edge-test.yml` = the edge on plain HTTP,
  127.0.0.1:8088 (`docker-compose.yml` is dev Postgres + Redis only). The
  owner chose Linode on 2026-09-29 (`docs/infrastructure-recommendation.md`);
  the env contract is `.env.prod.example`, the procedure
  `docs/runbooks/deploy.md` (rollback §3 = `git checkout afflino-previous`
  + `up -d --build`), the one-command install / update
  `deploy/linode/install.sh` (`deploy/linode/README.md`); the owner's Amazon
  steps `deploy/linode/amazon.sh` (§1A of the runbook). api and redirect
  trust X-Forwarded-For from loopback and private-range peers
  (`TRUST_PROXY=loopback,uniquelocal`): only the stack's own containers
  and Docker's proxy for the 127.0.0.1 ports, through which the
  host-networked edge reaches them.
- `docs/openapi.yaml` — OpenAPI 3.1 spec; `packages/api/test/openapi.test.ts`
  asserts the spec matches the registered routes in both directions. Keep in sync.

## Invariants — do not break these

1. **Money is integer minor units with explicit currency.** Never floats, never
   implicit currency, never rounding on ingest (CSV decimals are rejected).
   The one decimal input is a provider file that prints money as decimals
   (the Amazon earnings report's rupees): converted to paise exactly from the
   digits (`@paparazzi/shared` `parseDecimalMinorUnits`, BigInt, no fraction
   or exactly two fraction digits — `160` and `160.00` are both 16000,
   `160.5` and `160.005` are refused — Western or Indian grouping), anything
   else refuses the whole file; the product API's prices likewise (no exact
   conversion → no price).
2. **Ledger is double-entry, balanced, append-only.** Every posting debits =
   credits per currency; corrections are mirror adjustment entries, never
   updates/deletes. `packages/shared` owns this math.
3. **Every query is tenant-scoped.** Cross-tenant reads/mutations are tested as
   blocked (`phase3.test.ts`) — keep it that way.
4. **Idempotency on `(provider_account_id, source_transaction_id, line_id)`.**
   10 identical callbacks → 1 conversion, 1 financial effect (tested).
5. **Provider revision ordering.** A delayed `pending` must never overwrite
   `approved` (tested).
6. **Never guess attribution.** Unmapped `returned_click_ref` → suspense queue.
   Suspense retry only binds when the click actually exists; `NULL` refs are
   rejected, no fuzzy matching — enforced in code (`routes/suspense.ts`).
   The second basis (2026-09-29, Amazon) is exact too: a reported tracking ID
   attributes only to the ONE placement it is mapped to, when the mapping is
   older than the sale and the placement's campaign is the programme's; the
   store ID, an unknown ID, a younger mapping or a click whose tag disagrees
   → suspense with the reason stored (`TRACKING_ID_IS_STORE_DEFAULT`,
   `TRACKING_ID_UNMAPPED`, `TRACKING_ID_MAPPED_AFTER_SALE`,
   `ATTRIBUTION_CONFLICT`). Mappings are append-only (the setup never remaps a
   tracking ID); suspense = `click_id IS NULL AND placement_id IS NULL`.
7. **Maker-checker on payouts.** Approver cannot be preparer, cannot approve own
   batch (403, tested). Payout eligibility: approved + collected + return-hold
   cleared + payee checks.
8. **Unknown payout outcome → status query before retry.** Blind re-disburse
   returns 409 `TRANSFER_STATUS_UNKNOWN`; informed retry re-initiates the *same*
   transfer row (tested — no double payout).
9. **Unsupported merchants stay untracked.** Link guards return
   `PROGRAMME_NOT_APPROVED` / `OFFER_STALE` / `PROPERTY_FORBIDDEN` /
   `PUBLISHER_NOT_ACTIVE` / `PROPERTY_NOT_OWNER_OPERATED` (Amazon: the owner's
   tag only on the owner's own properties, PR 9, with no setting to allow
   third parties; only Facebook / Instagram / web properties); minting is
   blocked at the redirect join too. Amazon rows are written only by the
   Amazon report path (the CSV / webhook adapters refuse them).
10. **Dispute resolution never posts ledger entries.** A ticket can never create a
    payable sale (enforced in code).
11. **Demo/seed data is always TEST-labeled** (`Demo-` / `demo.` / `txn-demo-*` /
    `example.com`); the demo refuses to run with `NODE_ENV=production`.

## Key acceptance numbers (don't regress)

- INR 160 commission at 70/30 → publisher 11200 / platform 4800 (minor units)
- 50% reversal → publisher 5600 / platform 2400 remaining

## Docs index (read before changing behavior)

- `docs/pilot-checklist.md` — completed / outstanding-engineering /
  external-dependencies, each completed item linked to its proof
- `docs/action-tracker.md` — table of every external requirement
  (input needed, owner, dependency, acceptance criteria) plus the
  sandbox-verified items that are not gates
- `docs/capacity-plan.md` — the owner's 12-billion-views figure turned into
  hot-path arithmetic (clicks/s, `clicks` growth, cache, replicas, the web) and
  what is still unmeasured
- `docs/threat-model.md` — trust boundaries, mitigations cited to code/tests,
  12 residual risks, pentest scope input
- `docs/pentest-scope.md`, `docs/runbooks/` (deploy, backup-restore, alerts,
  incidents), `docs/monitoring/alerts.yaml`
- `docs/infrastructure-recommendation.md` — the owner's Linode decision and the
  single-host trade-offs (the earlier AWS ap-south-1 ≈₹6,700/mo / DO blr1
  ≈₹5,200/mo estimates kept as record); `docker-compose.prod.yml`,
  `docs/credential-setup.md`
- `docker/README.md` — the five images, how they are built, the smoke test
- `docs/vendor-rfp.md`, `docs/merchant-outreach.md`, `docs/counsel-briefing.md`
  — sendable docx versions in `~/workspace/your_files/paparazzi-gate-docs/`
- Per-package `ASSUMPTIONS.md` files (and `db/README.md`, `scripts/ASSUMPTIONS.md`,
  `docker/ASSUMPTIONS.md`) record deliberate simplifications, dated

## Known caveats

- Vitest still runs on pg-mem, which diverges from real Postgres in places
  (`unique nulls not distinct`, targeted `ON CONFLICT` arbiters are shimmed). The
  migrations and the money loop are proven on Postgres 16 by `DEMO_TARGET=postgres`;
  the app code still carries the pg-mem-friendly query shapes (bare `ON CONFLICT
  DO NOTHING`, `IN (...)` expansion, no `LATERAL`).
- Auth is a **JWT stub** (`scripts/mint-dev-token.mjs`, claims trusted verbatim;
  default TTL 8 h, `exp` enforced); production needs a real IdP + membership
  validation. The shop's `WEB_API_TOKEN` is that stub too.
- No webhook signature verification on API ingress; no rate limiting (also not
  on `/r/{token}`, nor at the edge); no CSP (the edge sets HSTS, nosniff,
  Referrer-Policy and X-Frame-Options only); `localStorage` bearer token in
  the web app's areas (`/login` writes it) — all flagged in the threat model
  as pre-launch work.
- The Afflino screens without a v1 endpoint are demo flows and say so: no
  OTP / identity provider, no KYC or PAN check, no platform OAuth, no brand
  self-serve offers or admin approval, no creator link listing or report
  aggregates, no publisher withdrawal, no agency roster
  (`docs/pilot-checklist.md`). The design's readable `/r/{handle}/{offer}`
  links and first-party attribution cookie are **not** implemented.
- No merchant programme exists. The only programme anywhere is the TEST "Demo
  Network Programme" from `db/seed-network.ts --with-demo-programme`
  (`shop.example.com`); the payout rail is the stub. Real ones are human-gated
  (`docs/action-tracker.md`). Amazon.in Associates is built but needs the
  owner's account (§1A) and counsel's privacy notice on `/privacy` (its
  `links` / `shop` steps refuse until then); its layout of the earnings
  download is unconfirmed (no sample), nothing records Amazon's payments as
  merchant settlements, so no Amazon earning becomes payable, and product-API
  prices will likely stop after the API's first 30 days (the build links
  `/dp/<ASIN>?tag=`, not the API's own links; `docs/capacity-plan.md`).
- CSV upload takes inline `csv_text` (2 MB cap) — production needs
  multipart/object-storage ingestion.
- Retention defaults are 365-day placeholders; counsel sets real windows.
- "No cookies, hashed IPs" is an **implementation detail for counsel to assess**,
  not proof of DPDP/ASCI compliance — never present it as such. The keyed
  `ip_hash` is pseudonymous, not anonymous (`docs/threat-model.md` §4.11).
- `pnpm audit` couldn't reach the npm endpoint from the sandbox; OSV showed zero
  known vulns on 171 pinned packages — re-run `pnpm audit` on CI.
- The load soak has never run on real infrastructure (`docs/capacity-plan.md`).

## Working rules

- Extend in place; keep per-package `ASSUMPTIONS.md` and this directory's README current.
- New behavior needs tests; new routes need OpenAPI spec updates (the
  bidirectional test enforces this: `EXPECTED_ROUTES` in
  `packages/api/test/openapi.test.ts` and `docs/openapi.yaml`).
- Never invent merchant names, credentials, approvals, or legal conclusions.
  Mark open questions as such; counsel/merchant/infra decisions belong to humans
  (see `docs/action-tracker.md`).
- Never write an AI model name or identifier into any file here.
- Nothing here is production-ready until the external gates in
  `docs/pilot-checklist.md` are closed.
