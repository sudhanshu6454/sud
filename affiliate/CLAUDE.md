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

## Verified state (2026-09-30)

- `pnpm typecheck` clean on all 5 packages (`packages/*`)
- **994/994 tests green across 61 test files** (`./node_modules/.bin/vitest run`:
  api 308, redirect 13, shared 52, workers 39, web 582; re-run 2026-09-30 after
  the owned default; 986 after the fixes of three independent reviews of the
  celebrity looks, 937 in 59 files after stage 2, 878 in 56 after the
  backend, 788 in 46 before it)
- **The owned default** (2026-09-30; the owner: "all clips are owned by us",
  "all footages captured in public place of any celebrity they dont own the
  rights we own it"; `packages/api/src/looks/ownership.ts`, 0007 section 11
  `library_ownership_statements` and `assets.licence_via`, edited in place;
  `packages/api/ASSUMPTIONS.md` "The owned default"). The owner records a
  dated statement on the server (`looks.sh owned`: the legal owner's name,
  who shot the clips, the words confirmed with `yes`; audited; append-only;
  `owned withdraw` ends it and narrows everything it licensed to an unknown
  licence at once). A library row without licence columns takes it
  (commercial reuse, WW, no end, the statement as the chain of title); a row
  with its own licence keeps it; with no statement such a row refuses the
  file as before. A person's licence edit through the API is never widened
  by a later file (`licence_kept`; before this a re-import silently undid a
  person's narrowing). Recording / withdrawing takes the import's lock. It
  covers the footage only: the celebrity gate is unchanged. Tests:
  `library-import.test.ts` "the owned default" (8); `pnpm looks:pg` O1–O3
  (10 rounds of an import racing a withdrawal: nothing licensed by a
  withdrawn statement). 0007 re-verified on a scratch Postgres 16 at 0006
  seeded with the owner's real network file under `NODE_ENV=production`
  plus an Amazon setup with TEST IDs: `1 migration(s) applied, 6 already
  applied`, the 15 non-empty tables' counts unchanged, a second seed
  byte-identical (database dropped). `looks.sh owned` rehearsed against a
  TEST stand-in for `docker` (Docker was not running), not on the
  installer's stack (`deploy/linode/README.md` "What was checked").
- **Celebrity looks after three independent reviews** (2026-09-30; 54
  findings, TEST data only; `packages/api/ASSUMPTIONS.md` "After three
  independent reviews", `packages/web/ASSUMPTIONS.md` 92 and 97–103,
  `packages/api/test/celebrity-controls.test.ts`, 30 tests). `pnpm
  looks:pg` **51/51** (47 before the owned default's O1–O3), "LOOKS: ALL PASS" (the headline without the name, the
  still at its own address, a storefront named after a celebrity 422, `/r/`
  302 with afflino.com's tag `demo-web-21`, the still 410 after the
  takedown with the share URLs and the still listed, and a new race R5: 10
  rounds of a mint against a review turning products off, never an active
  link). 0007 (edited in place: `looks.place_confirmed_by/at/note`) on a
  fresh Postgres 16 (`7 applied`, then `0 applied, 7 already applied`) and
  on databases at 0006 seeded like production (network seed under
  `NODE_ENV=production` + an Amazon setup; and the demo graph with 7 legacy
  EXACT items without evidence): `1 migration(s) applied, 6 already
  applied`, every row count unchanged, a second network seed
  byte-identical. A local stack (scratch Postgres 16 + Redis 7, the tsx api
  with `TRUST_PROXY` and redirect, `next start` and the standalone
  `server.js`): the look page piece by piece with only `/r/` links, the
  image at `/img/looks/<id>?v=…` (200 `image/png`; a name-only look's 404,
  no image box; a withdrawn look's 410), the name-only look without the
  commercial label, a withdrawn look **410 on both servers** (a rewrite had
  answered 200 on both; the middleware now answers the 410 itself with the
  `/withdrawn` page's markup, no script), a takedown through the API → the
  web's 410 at 5.5 s on a page probed just before, the revalidation `web:
  attempted, ok, 200, batches 1`, `public_cache: cleared`, `/r/` the paused
  page, restore 409 then 200 after a new review, `/r/` 302 again; a
  visitor through the web's `/api` over the limit: 247 × 200 then 429 with
  Retry-After while another visitor and the pages stayed 200; the api's
  answer and still caches `x-public-cache: hit`; Meta's data deletion 200
  signed / 401 wrongly signed; no verify token and no client address in
  the api log; rollups: today's row of the clicked link = its 2 raw
  clicks; analytics 403 for `publisher_analyst`. Screenshots at 1280 and
  390 px (17 pages each: feed, hub, look, name-only look, withdrawn 410,
  storefront, storefront 404, the admin screens incl. the placing editor
  and the street look for the rights reviewer) with no horizontal overflow
  and no page error. `docker/README.md`'s smoke test verbatim on images
  rebuilt from this tree (every observed line unchanged); the installer's
  rehearsal in test mode with every `looks.sh` step (`keys` with a
  made-up verify token at the hidden prompt, `webhook` printing the fields
  and the data deletion address and no secret, `reply-test` with
  `messaging stop: ok`, `takedown` listing the Sharing Debugger addresses
  and the still, the web image's 410 through the edge;
  `deploy/linode/README.md` "What was checked"); ShellCheck 0.11.0 and
  0.9.0 clean; `pnpm install --frozen-lockfile`, the web build (0 files in
  `.next` with `amazon.in/`, `/dp/B0` or `amzn.`), compose `config -q` in
  three combinations; the money-loop demo on pg-mem and on Postgres 16 ("All
  demo assertions passed.") and `pnpm race:pg` ("RACE: ALL PASS") re-run.
  Not run on the Linode; no Meta call was made.
- **Celebrity looks, stage 1 of 2: the backend** (2026-09-30; the owner's "we
  are tag product according to celeb outfit or similar to celeb outfit"; TEST
  data only, nothing about any celebrity on afflino.com; the web pages are
  stage 2). `0007_celebrity_looks.sql` applies on a fresh Postgres 16 (0001–0007)
  and on top of a database migrated to 0006 and seeded like production
  (`1 migration(s) applied, 6 already applied`, every row count unchanged, a
  second network seed byte-identical; the looks CLI then refusing TEST rows
  under production, importing, re-importing without change, refusing a review
  without evidence, reviewing, storefronts, takedown, restore 409 then 200).
  `pnpm looks:pg` (`scripts/celebrity-looks-pg.ts`, scratch database
  `paparazzi_demo_looks_<8 hex>` created and dropped; also in CI): **43/43**,
  "LOOKS: ALL PASS" — import (2 drafts, 2 unreviewed celebrities, 4 pieces;
  a second import changes nothing) → publish 409 while unreviewed, public 404
  → rights review → EXACT without evidence 422, with evidence pending, the
  tagger's own approval 403, a second editor's 200; 4 SIMILAR through instant
  links → the publish gate passes → look page / feed / hub / storefront /
  sitemap with only `/r/` links → `/r/` 302 to
  `…/dp/B0DEMO0201?tag=demo-ig-21` → a signed Meta comment → one event, one
  stub message carrying only `https://afflino.example.com/looks/<id>`, 5
  replays no-op, a bad signature 401, no raw id or text stored → takedown:
  410 look + hub, feed / storefront / sitemap empty, 5 links on the paused
  page, a new comment queues nothing → restore 409 without a new review, 200
  after it, `/r/` 302 again → rollups (2 clicks, 1 via the storefront); races
  the pg-mem suite cannot prove: the partial unique indexes (23505) and EXACT
  checks (23514), 10 rounds of a mint racing a takedown (never an active link
  on a withdrawn look), 10 concurrent deliveries (one event), 5 senders (one
  message). The api / workers / redirect images build with the new code;
  in the api image the CLI refuses TEST rows under the image's
  `NODE_ENV=production`, the public API answers 200 with `Cache-Control:
  public, max-age=30`, the webhook's GET verification echoes the challenge
  and a POST without the app secret is 503; the workers boot 7 queues
  ('on' without Meta keys falls back to off, logged); the edge validates in
  both modes and answers 404 for `/internal/*`. Not run on the Linode; no
  Meta call was made.
- **Celebrity looks, stage 2 of 2: the web, the owner's steps, the docs**
  (2026-09-30, TEST data only). On a local stack (scratch Postgres 16 with
  the TEST library, the tsx api and redirect, `next start` on the build):
  `/shop` is the Spotted feed (the trending row, filters by celebrity and
  page, the grid, the pager; "Nothing spotted yet." when empty), `/c/<slug>`
  the hub, `/looks/<id>` the look (the still with numbered markers, none on
  eyewear / headwear / jewellery; the moment; "View the original post"; the
  outfit piece by piece, the exact match first, then similar styles; every
  product "Buy on Amazon.in" through `/r/` only, "See price on Amazon.in", the
  Associate statement beside the button; the non-endorsement line wherever a
  celebrity is named), `/s/<slug>` the storefront (share, QR); the admin
  screens (Celebrities, Library, Looks + the pieces editor, Takedowns,
  Instant links, Comment replies, Analytics with CSV) live with a
  network-admin sign-in and TEST data without one; no `amazon.in/` string in
  a look's HTML or in `.next`; screenshots at 1280 and 390 px with no
  horizontal overflow and no page error. A takedown: the middleware's 410
  (no-store, noindex) 5.0 s after it on a page probed just before (at once
  on one not probed), the revalidation call `web: attempted, ok, 200` after
  the takedown and after its restore, a wrong secret 401; a hub with no
  public look 404. An EXACT tag: its tagger's approval 403, the second
  editor's sign-in (`looks.sh signin`, choice 3) 200. `docker/README.md`'s
  smoke test verbatim (7 migrations, `/shop` titled "Spotted · Afflino",
  `/internal/revalidate` 404 through the edge, `/c/nobody` 404); the
  installer's rehearsal in test mode with every new `looks.sh` step
  (`deploy/linode/README.md` "What was checked"); ShellCheck 0.11.0 and
  0.9.0 clean. Not run on the Linode; no Meta call was made.
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
  web build, the real-Postgres migrate + seeds, `race:pg` and (since 2026-09-30)
  `looks:pg`; no run has been observed from this sandbox; it also runs
  ShellCheck on `deploy/linode/*.sh`

## Commands

All from `affiliate/`. `pnpm` is `/opt/node22/bin/pnpm` in this sandbox; `tsx` is
not at the repo root, so the scripts that need it are given with the api package's
copy.

```bash
./node_modules/.bin/vitest run                                        # tests (986)
pnpm typecheck                                                        # 5 packages
./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts       # demo on pg-mem (51 assertions)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi DEMO_TARGET=postgres ./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts   # same demo on real Postgres (scratch DB, dropped)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx scripts/amazon-import-race.ts   # Amazon imports under concurrency (pnpm race:pg; scratch DB, dropped)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx scripts/celebrity-looks-pg.ts   # celebrity looks story + races (pnpm looks:pg; scratch DB, dropped)
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
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx packages/api/src/cli/looks.ts status    # the celebrity-looks CLI (import | ownership | status | celebrities | review | takedown | restore | takedowns | storefronts | events | reply-test | sign-in)
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

The owner's celebrity-look steps, one line each (`docs/runbooks/deploy.md` §1C;
the library file copied from the Mac first, the runbook's line):
`bash /opt/afflino/affiliate/deploy/linode/looks.sh owned` once (the ownership
statement; `owned withdraw` ends it), then
`bash /opt/afflino/affiliate/deploy/linode/looks.sh import` (then `celebrities`,
`review`, `storefronts`, `storefronts live`, `signin`, `status`, `takedown`,
`takedowns`, `restore`, `keys`, `webhook`, the update line, `accounts`,
`reply-test`, `replies shadow | on | off`, `events`).

Notes: `pnpm demo`, `pnpm demo:pg`, `pnpm race:pg`, `pnpm looks:pg`, `pnpm seed`, `pnpm seed:network` call the api
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
  `POST /v1/links`. Tests: `test/catalogue.test.ts`. Since 0007 the catalogue
  leaves out celebrity looks and looks under a takedown for consumer roles,
  and removed items.
- **Celebrity looks** (0007, 2026-09-30; `packages/api/src/looks/`,
  `packages/api/ASSUMPTIONS.md` "Celebrity looks"): a look is a moment
  (celebrity, event / place, date, video, still, the in-house page and post)
  with the outfit piece by piece (`look_pieces`); products are tagged into a
  piece on the existing `look_items` as EXACT (evidence + source, a second
  person's approval, one per piece) or SIMILAR (default, several). The rules
  live in `@paparazzi/shared` `celebrity.ts` (one capability matrix per
  rights status, narrowed by the celebrity's review; the wording lint) and
  `replies.ts`. Publishing goes through `looks/gate.ts` (rights, minors /
  never-list, takedown, image licence, moment date, in-house page, wording,
  every piece has a product, EXACT reviewed, live offers, the link guards as
  a dry run of `src/links/mint.ts`), and every public read re-checks it in SQL
  (`looks/public.ts` `readGateSql`) and masks in JS (`effectiveLookDisplay`).
  The public read API `/v1/public/{org}/spotted | celebrities/{slug} |
  looks/{id} | storefronts/{slug} | sitemap` (no token, published only,
  resolved by the organisation's slug, `Cache-Control: public, max-age=30`;
  410 `GONE` under a takedown); the operator API (`/v1/celebrities`,
  `/v1/editorial/*` incl. instant links over `src/amazon/offers.ts`,
  `/v1/takedowns`, `/v1/replies/*`, `/v1/analytics/*`); links of a look are
  minted for afflino.com's web placement (its own tracking ID; the in-house
  pages' links for their posts come from instant links), only for approved
  items, and serialized with a takedown or a review by a row lock on the
  look (`looks/look-links.ts`); a celebrity's name appears only in the
  credit line of their own look — every other text is checked against every
  name and alias when written and at every read (`looks/names.ts`); the
  headline is name-free ("Spotted at <event>"); the still is served at
  its own address (`GET /v1/public/{org}/looks/{id}/still`, `looks/still.ts`,
  behind the web's `/img/looks/<id>`); the public API and the Meta webhook
  are rate-limited per client and the public answers cached 30 s under a
  Redis epoch every invalidation increments (`src/public-guard.ts`; the
  web's own server-side calls are not counted); a takedown / rights
  downgrade / unpublish pauses links with their reason and clears the route
  cache twice (`looks/invalidate.ts`, plus a best-effort web revalidation,
  `WEB_REVALIDATE_URL` / `WEB_REVALIDATE_SECRET`). The library import
  (`looks/library-import.ts`, CLI `src/cli/looks.ts` → `dist/cli/looks.js`)
  takes a row's licence from its own columns or, with none, from the
  owner's ownership statement in force (`looks/ownership.ts`; none in
  force → the row refuses the file), refuses a whole file on any bad row,
  never widens a licence a person edited, is idempotent on the video
  reference and runs under an advisory lock (recording or withdrawing the
  statement takes it too). The Meta
  webhook (`routes/meta-webhook.ts`: GET verify; POST
  `X-Hub-Signature-256` over the raw body, constant-time; 503 without
  `META_APP_SECRET`) stores one `reply_events` row per comment (`on conflict
  (platform, comment_id) do nothing`), the commenter only as
  HMAC(`COMMENT_ID_HASH_KEY`, platform:account:id). Stage 2 added what the
  web needs: `/v1/public/{org}/spotted` carries `facets` (celebrities and live
  storefronts with counts, through the read gate) and `commercial_label`;
  `GET /v1/public/{org}/trending` (looks ranked by the last 1–30 days of
  `click_daily`, re-gated, no counts returned); `GET
  /v1/editorial/properties`; `POST /v1/editorial/library/import` (a dry run
  by default: `checkLibrary`, the same checks as the import; 422 with the
  problems); `GET /v1/replies/events` (never the comment id, commenter
  hash, media id or message id); every reply rule answers with its
  `dm_preview`. The CLI's `sign-in --role network_admin | editor |
  rights_reviewer` mints the JWT stub for the admin (the second editor is a
  user of its own, so the EXACT maker-checker holds), `reply-test` and
  `events`.
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
  cannot be persisted). A paused link (0007: takedown, rights review,
  unpublished look, removed product) serves the paused page; `?via=<slug>`
  goes into `clicks.context.via` only. The client address is `req.ip` under `TRUST_PROXY`
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
  429 / 401 / 403, reactivates an offer Amazon lists again); since 0007
  `comment-replies` (a sweep every `COMMENT_REPLIES_SWEEP_MS` enqueues ready
  events; a conditional claim; one private reply per comment carrying only
  the look's afflino.com URL; an unknown outcome is never resent;
  `COMMENT_REPLIES_SENDING` off (default) | shadow | on, a stub sender unless
  on with the Meta keys; `src/replies/`, `src/meta/graph.ts`) and `analytics`
  (hourly IST rollups into `click_daily` / `reply_daily`, `src/analytics/`);
  retention's fourth class deletes `reply_events` after 30 days.
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
  `shop` refuse to go past. **Celebrity pages** (2026-09-30, stage 2;
  `packages/web/README.md` screen map, web ASSUMPTIONS 87+): `/shop` is the
  Spotted feed (trending row, filters, grid, pager; the network's looks
  below it as "More looks"), `/c/[slug]`, `/looks/[id]` (the public look
  first, the catalogue look otherwise), `/s/[slug]` (own slim layout);
  `lib/public-catalogue.ts` (server-only) reads `/v1/public/{PUBLIC_ORG_SLUG}/…`
  with no token, `revalidate: 30` and cache tags, the TEST demo only when
  the API is unreachable (an answer, even 404 / 410, is never replaced by
  demo data); `lib/spotted.ts` maps the wire and drops any product link that
  is not `https?://host/r/<32 hex>` and any post URL that is not a Facebook /
  Instagram https URL, and gives eyewear, headwear and jewellery no marker
  (`NO_MARKER_CATEGORIES`); the wording ("The same item", "Similar style.
  <name> did not wear or endorse this product.", the non-endorsement line,
  the commercial label) comes from the API, the page labels from
  `CELEBRITY_WEB` in `lib/site-copy.ts` (drafts pending counsel).
  `middleware.ts` (`/looks/*`, `/c/*`) answers 410 (no-store, noindex) for a
  withdrawn look or hub after a HEAD on the public API (2 s; per process
  "not withdrawn" kept 5 s, "withdrawn" 30 s; unreachable → the page renders,
  which shows only the withdrawn notice or the error state); the 410's body
  is the web's own `/withdrawn` page rendered from `WEB_INTERNAL_ORIGIN`
  (default `http://127.0.0.1:$PORT`) with its scripts removed (a rewrite
  cannot carry the 410 in Next 14).
  `/internal/revalidate` (POST, `x-revalidate-secret` =
  `WEB_REVALIDATE_SECRET`, HMAC-compared; 503 without a secret of 16+
  characters; known tags only) is what a takedown calls; the edge answers
  404 for `/internal/*`, so only the api reaches it over the compose
  network. `CELEBRITY_INDEXING` (runtime, default off) only narrows
  `SITE_INDEXING`: celebrity pages (and `/shop` while its feed shows a look)
  are noindex and out of the sitemap unless both are `on`; og / twitter
  descriptions are the non-endorsement line. The admin screens
  (`components/admin/celebrity/`, `/admin/{celebrities,library,looks,
  takedowns,instant-links,replies,analytics}`) call the operator API with
  the `/login` bearer and fall back to TEST data (`lib/demo/celebrity.ts`,
  a fixed clock) with the badge.
- `db/migrations/` — `0001_core.sql` → `0007_celebrity_looks.sql` (0007:
  celebrities and their rights reviews, licence facts on assets, the moment
  on looks, pieces, piece-scoped EXACT / SIMILAR on `look_items`,
  storefronts, takedowns, paused links, comment-reply tables, `click_daily`,
  the `rights_reviewer` role; `db/README.md` "Celebrity looks (0007)"; 0006: the
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
    Celebrity fixtures are "Demo Star …" people only; real celebrity names and
    library data live on the server, never in this repository.
12. **The rights gate: nothing about a celebrity is public unless counsel's
    review allows it.** A new celebrity is `unreviewed` (nothing shown);
    `blocked` shows nothing; `editorial` at most the name, no products;
    `cleared` at most name, image and products; each review narrows that and
    defaults to name only, no products (`@paparazzi/shared` `celebrity.ts`,
    the one matrix; a change to it is counsel's, then a code change). A minor
    is never published. It is enforced at publish (`looks/gate.ts`),
    re-checked in SQL on every public read (`readGateSql`: feed, hub, look,
    storefront, trending, facets, sitemap) and masked in JS
    (`effectiveLookDisplay`); a takedown answers 410 everywhere and pauses the
    links at once, and lifting it needs a new review recorded after it. The
    web never shows what the API did not return and never names a celebrity
    without the non-endorsement line. Tests: `celebrity-looks.test.ts`,
    `takedowns.test.ts`, `celebrity-web-support.test.ts`, shared
    `celebrity.test.ts`, web `spotted.test.ts` / `celebrity-web.test.ts`.
13. **EXACT only with evidence and a second person.** "The same item" (EXACT)
    needs the evidence (10+ characters) and its source (3+), and approval by
    a different user from its tagger (403 for the tagger; CHECK
    `match_reviewed_by <> tagged_by` in 0007), one per piece; an unapproved
    EXACT never shows. Everything else is SIMILAR, whose wording never claims
    the same item ("Similar style. <name> did not wear or endorse this
    product."); the wording lint refuses endorsement claims ("worn by",
    "dupe", "for less", …) in any editor text. Tests:
    `look-pieces.test.ts`.
14. **Type never sits on a face** (the owner's rule). The still carries only
    small numbered markers on garments; eyewear, headwear and jewellery get
    none (`NO_MARKER_CATEGORIES`, the page and the editor's preview); all
    other text sits outside the image (`StillImage`). Test: web
    `spotted.test.ts`.

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
  13 residual risks, pentest scope input
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
- No webhook signature verification on the stub-network ingress (the Meta
  webhook of 0007 verifies `X-Hub-Signature-256`); no rate limiting on
  `/r/{token}` or at the edge (the public read API and the Meta webhook have
  a per-process, per-client limit in the api since 2026-09-30); no CSP (the edge sets HSTS, nosniff,
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
- Retention defaults are 365-day placeholders (30 days for `reply_events`);
  counsel sets real windows.
- Celebrity looks (0007) are built, backend and web, with TEST data only;
  nothing about any celebrity is on afflino.com until the owner imports the
  library and counsel's reviews are recorded. Every rights, wording (the
  web's labels in `CELEBRITY_WEB` too), evidence, takedown-timeline,
  indexing and retention question is counsel's (`docs/counsel-briefing.md`
  §10); comment replies need Meta App Review, Business Verification and Live
  mode and are off by default; the rights reviewer and the second editor
  are roles on the JWT stub, so they are as forgeable as every other role
  until a real IdP exists (`looks.sh signin` writes one sign-in at a time to
  a root-only file; the owner hands each to its person); the takedown SLA
  figures are reported, not alerted. The web's 410 lags a takedown by up to
  5 s per web process (the middleware's cache; the page itself shows only
  the withdrawn notice at once); the Meta verify token is one the owner
  makes up at `looks.sh keys`' hidden prompt and is never printed. The name
  and endorsement checks are English word lists; the chain of title is
  checked for presence, not validity; nothing alerts on Meta's
  `messaging_policy_enforcement` deliveries yet.
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
