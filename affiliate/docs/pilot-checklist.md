# Pre-pilot checklist

What is built and proven in this sandbox vs what still needs engineering or a
human before the pilot. Last verified test run (2026-09-30): **986/986 green
across 61 files** (`./node_modules/.bin/vitest run`: api 300, redirect 13,
shared 52, workers 39, web 582, with the celebrity looks' backend and web and
the fixes of three independent reviews; the earlier figures of 57, 94, 133,
558, 587, 612, 616, 660, 669, 768, 784, 878 and 937 are stale). Legend: ✅ verified in this repo · ⏳ not done — needs
engineering work · 👤 needs a human (see
[EXTERNAL DEPENDENCIES](#external-dependencies) and the
[action tracker](./action-tracker.md)).

**This checklist is not a production-readiness statement.** Everything under
COMPLETED & VERIFIED was exercised in this sandbox: the unit tests against
pg-mem and stub connectors, the migrations, seeds, money-loop demo and the
five Docker images against a local PostgreSQL 16.13 and Redis 7. None of it
has seen real merchants, real money, real traffic or a real host.

## COMPLETED & VERIFIED

- ✅ `pnpm typecheck` clean across all 5 packages.
- ✅ `pnpm install --frozen-lockfile` passes with pnpm 9.12.0, the
  `packageManager` pin, used locally, in CI and in the images
  ([`docker/README.md`](../docker/README.md) "pnpm version policy"). The old
  "known-broken" note is obsolete.
- ✅ `vitest run` green — 784 tests in 45 files: ledger math
  ([`packages/shared/src/ledger.test.ts`](../packages/shared/src/ledger.test.ts)),
  money-loop API incl. idempotency ×10, revision ordering, suspense,
  reversals, payout gates, maker-checker
  ([`packages/api/test/money-loop.test.ts`](../packages/api/test/money-loop.test.ts),
  [`packages/api/test/suspense-ops.test.ts`](../packages/api/test/suspense-ops.test.ts)),
  CSV connector
  ([`packages/api/test/csv-connector.test.ts`](../packages/api/test/csv-connector.test.ts)),
  provider-events worker
  ([`packages/workers/test/provider-events.test.ts`](../packages/workers/test/provider-events.test.ts)),
  retention purge
  ([`packages/workers/test/retention.test.ts`](../packages/workers/test/retention.test.ts)),
  phase-3 acceptance: tenant isolation, link guards, kill switch, onboarding,
  disputes, contract versioning
  ([`packages/api/test/phase3.test.ts`](../packages/api/test/phase3.test.ts)),
  **catalogue endpoints** — list fields, pagination, cheapest live offer,
  stale/paused → null, link read-back, 404-only visibility, no `offer_url`
  in any body
  ([`packages/api/test/catalogue.test.ts`](../packages/api/test/catalogue.test.ts)),
  the **consumer web's** catalogue client and fallback rules and
  `mint-links.mjs` end to end against a stub API
  ([`packages/web/test/catalogue.test.ts`](../packages/web/test/catalogue.test.ts),
  [`packages/web/test/mint-links.test.ts`](../packages/web/test/mint-links.test.ts)),
  the **Afflino screens'** models (formats, validators, onboarding, earnings
  mapping, link composition and a QR decoder, payouts / TDS, reports and CSV,
  brand fees, admin queue, agency share, shop CTA states; 17 more files in
  [`packages/web/test/`](../packages/web/test/)),
  the network seed's file validation
  ([`packages/api/test/seed-network.test.ts`](../packages/api/test/seed-network.test.ts)),
  OpenAPI contract
  ([`packages/api/test/openapi.test.ts`](../packages/api/test/openapi.test.ts)
  against [`docs/openapi.yaml`](./openapi.yaml)).
- ✅ Money-loop demo green on **both targets** —
  [`scripts/demo-money-loop.ts`](../scripts/demo-money-loop.ts), 51 assertions:
  link → click → conversion (INR 160 commission) → ledger 112/48 → webhook
  dedupe → 50% reversal → 56/24 → merchant settlement → payout batch
  (maker-checker enforced, self-approve 403) → disburse → provider callback →
  liability cleared, plus payout-failure handling (unknown outcome → 409 on
  blind retry → status query → informed retry → paid, one transfer row).
  `pnpm demo` runs it on pg-mem; `DEMO_TARGET=postgres` (`pnpm demo:pg`)
  runs the identical assertions on a **real PostgreSQL 16.13** with the
  migrations applied verbatim (no shims), on a scratch database
  `paparazzi_demo_<8 hex>` that is dropped at exit (verified: 0 left in
  `pg_database`). All demo data is TEST-labelled; both targets refuse
  `NODE_ENV=production`.
- ✅ Migrations `0001`–`0005` on real Postgres 16 with tracking —
  [`db/migrate.mjs`](../db/migrate.mjs) records each file in
  `schema_migrations` inside the file's own transaction; a fresh database
  applies 5, a second run reports `0 migration(s) applied, 5 already
  applied`; `--status` lists applied/pending; `--baseline` records the
  present files for a database migrated before tracking existed (a plain
  run on such a database fails loudly on `0001` with a hint, by design).
  Details: [`db/README.md`](../db/README.md) "Migration tracking".
- ✅ Seeds on real Postgres — [`db/seed.ts`](../db/seed.ts) (demo graph, now
  filling the `0005` look columns) and
  [`db/seed-network.ts`](../db/seed-network.ts) (Afflino's in-house
  publisher network: organisation, four role users, one property per entry
  of a network file — default the TEST
  [`db/network.example.yaml`](../db/network.example.yaml), five platforms —
  plus the shop's own `web` property from `WEB_HOST`, and with
  `--with-demo-programme` the TEST programme, one published look per
  property and the placements incl. `web_placement_id`). The network seed is
  idempotent: two runs on a fresh database give identical row counts and
  byte-identical JSON; operator status changes survive a re-run; another
  organisation's property or placement makes it fail and roll back. The
  network file's validation is unit-tested
  (`packages/api/test/seed-network.test.ts`).
- ✅ Docker images build and boot —
  [`docker/Dockerfile.{api,redirect,workers,web,migrate}`](../docker/):
  `--no-cache` builds of 264 / 270 / 255 / 269 / 262 MB (web 273 MB after
  the Afflino rebuild), all running as the
  unprivileged `node` user. The recorded smoke test
  ([`docker/README.md`](../docker/README.md)) boots Postgres 16 + Redis 7 +
  all five images: migrate applies 0001–0005, both seeds run, `/healthz` on
  api, redirect and the web's `/api` proxy answer `{"ok":true}`, `/` is
  titled "Afflino", `/shop` renders the TEST network looks live (no
  demo badge), `mint-links.mjs` mints
  one link (`minted=1 … failed=0`), the look page shows
  `<a href="…/r/<token>" rel="sponsored nofollow noopener">View at
  merchant</a>`, `GET /r/<token>` answers `302` to the TEST destination with
  `subid=<click_id>` and no `set-cookie`, one row lands in `clicks`, and the
  workers log `click.observed`. Sandbox caveat: the builds needed a base
  image carrying the sandbox's egress CA; the Dockerfiles carry no such
  setting.
- ✅ Consumer shop live — [`packages/web`](../packages/web/README.md): `/shop`
  (moved from `/` on 2026-09-29), `/looks/[id]`, `/looks/[id]/items/[itemId]` read the catalogue API
  server-side with a server-only token; every merchant CTA is the tracked
  `/r/{token}` link or a visibly disabled control; no raw merchant URL is
  returned by the API or rendered (asserted in
  `packages/api/test/catalogue.test.ts` and the web tests).
- ✅ **Afflino web app built** (2026-09-29) —
  [`packages/web/README.md`](../packages/web/README.md) "Screen map": every
  artboard of the design handover (1a–3f) plus the undrawn pages of each
  area, on the handover's tokens, self-hosted Archivo and one set of
  primitives. `next build` OK; on the build (`next start`) all 36 crawled
  routes answer 200 and all 110 internal links they render resolve (200 or
  an intended 307), every page that shows TEST data carries the "Demo data"
  badge, and no page requests Google Fonts, names a real merchant from the
  design mocks or mentions a cookie. **What is live today** from the app
  areas: `GET /v1/publisher/earnings` (overview and payouts balances),
  `POST /v1/links`, `GET` / `POST /v1/disputes`, `GET /v1/suspense` + retry
  / review, `POST /v1/publishers`; the shop reads `GET /v1/looks[/:id]`
  server-side. Everything else is labelled demo data (below).
- ✅ CI workflow defined — `afflino` (`.github/workflows/afflino.yml` at the
  repository root, on push and pull request for changes under `affiliate/`):
  frozen install, typecheck, vitest, both demos, web build, migrate + seeds
  (`seed.ts`, `seed-network.ts --with-demo-programme`) on a Postgres 16
  service. The file parses as YAML; **no CI run has been observed from this
  sandbox**.
- ✅ Kill switch exercised: pause → paused page + `route:{token}` cache
  invalidation + blocked minting → resume → 302 (see
  [`packages/api/test/phase3.test.ts`](../packages/api/test/phase3.test.ts)).
- ✅ **CSV import path built and tested** — connector
  ([`packages/api/test/csv-connector.test.ts`](../packages/api/test/csv-connector.test.ts)),
  fixture
  ([`packages/api/test/fixtures/sample-settlement.csv`](../packages/api/test/fixtures/sample-settlement.csv)),
  upload route
  ([`packages/api/src/routes/csv-uploads.ts`](../packages/api/src/routes/csv-uploads.ts)).
  Caveat: upload is an inline string (`csv_text`, 2 MB cap) — a deliberate
  sandbox simplification; production wants multipart or object-storage
  references (see [OUTSTANDING ENGINEERING](#outstanding-engineering)).
- ✅ Backup/restore scripts written with their assumptions recorded:
  [`scripts/backup.sh`](../scripts/backup.sh),
  [`scripts/restore.sh`](../scripts/restore.sh),
  [`scripts/ASSUMPTIONS.md`](../scripts/ASSUMPTIONS.md) (production guard,
  pg_dump flags, manifest-as-evidence, WAL archiving and encryption marked
  **open**), plus the runbook
  [`docs/runbooks/backup-restore.md`](./runbooks/backup-restore.md).
  The full drill against real Postgres is still outstanding (below).
- ✅ Threat model written:
  [`docs/threat-model.md`](./threat-model.md) — trust boundaries,
  per-component STRIDE with mitigations tied to code/tests, residual risks
  that must be fixed before any shared environment, and a proposed pentest
  scope.
- ✅ Runbooks written and reviewed:
  [`docs/runbooks/`](./runbooks/) — deploy (afflino.com on a single Linode:
  `docker-compose.prod.yml` + `docker-compose.single-host.yml`, the edge in
  front; managed databases as the alternative), tracking outage,
  wrong-product/rights, merchant nonpayment, publisher fraud, data incident.
- ✅ Production deploy shape for afflino.com (2026-09-29), rehearsed end to
  end locally with the edge in plain-HTTP mode (README.md "Deploying
  afflino.com"): Caddy edge as the only public listener (TLS for the apex
  and www only, www → apex, security headers, client-supplied
  X-Forwarded-For overwritten, no access log), `TRUST_PROXY` on api and
  redirect, the keyed click hash (`IP_HASH_KEY`), the indexing gate
  (`SITE_INDEXING`, off by default), Postgres and Redis on the same host.
  **Nothing has been deployed to the Linode or the domain.**
- ✅ One-command install / update for the Linode (2026-09-29):
  [`deploy/linode/install.sh`](../deploy/linode/install.sh) with
  `backup.sh`, `restore.sh` and the optional `godaddy-dns.sh`; the edge on
  host networking so afflino.com can carry an AAAA record. ShellCheck clean
  and rehearsed in the sandbox
  ([`deploy/linode/README.md`](../deploy/linode/README.md) "What was
  checked"), again after the review fixes: migrations before anything is
  recreated (a failing one leaves the stack as it was), the rollback tag
  `afflino-previous`, the rest of the run from the checkout's own copy, a
  refusal on a server that runs other compose projects, the route cache
  cleared by `restore.sh --replace-live`, the edge's own errors with the
  security headers. **The owner ran it on the Linode (172.105.52.150) on
  2026-09-29**: afflino.com answered over HTTPS with Let's Encrypt
  certificates for the apex and www at 17:20 UTC.
- ✅ Capacity plan written from the owner's figure:
  [`docs/capacity-plan.md`](./capacity-plan.md) — arithmetic only; nothing
  in it is measured.
- ✅ Data minimisation posture is an **implementation detail for counsel to
  assess, not evidence of compliance**: the API/redirect currently set no
  cookies and the click path hashes IPs; retention is window-agnostic and
  mechanically implemented
  ([`packages/workers/src/retention/`](../packages/workers/src/retention/))
  with 365-day sandbox defaults in
  [`packages/workers/src/retention/config.ts`](../packages/workers/src/retention/config.ts).
  Counsel sets the real windows and confirms whether this posture is
  sufficient — see [`docs/counsel-briefing.md`](./counsel-briefing.md) §1
  [DECISION] markers and the [action tracker](./action-tracker.md).

- ✅ **Celebrity looks backend (2026-09-30, TEST data only; nothing on
  afflino.com).** Migration 0007 on a fresh Postgres 16 and on a
  production-like database at 0006 (network seed under
  `NODE_ENV=production`, an Amazon setup): `1 migration(s) applied, 6 already
  applied`, row counts unchanged, a second network seed byte-identical. The
  library import (drafts, unreviewed celebrities, assets with licences,
  pieces; idempotent; whole-file refusal; TEST rows refused under
  production), the capability matrix and rights reviews, outfit pieces with
  EXACT (evidence + a second person) / SIMILAR tagging, the publish gate, the
  public read API (feed, hub, look piece by piece, storefront, sitemap: never
  more than the rights allow, only `/r/` links), instant links, takedowns
  (410 everywhere, links paused → the paused page, caches cleared, replies
  off, restore after a new review), comment replies (signed webhook, one
  message per comment with only the afflino URL, opt-outs, hashes only) and
  daily rollups with analytics — [`celebrity-looks.test.ts`](../packages/api/test/celebrity-looks.test.ts),
  [`takedowns.test.ts`](../packages/api/test/takedowns.test.ts),
  [`comment-replies.test.ts`](../packages/api/test/comment-replies.test.ts),
  [`look-pieces.test.ts`](../packages/api/test/look-pieces.test.ts),
  [`library-import.test.ts`](../packages/api/test/library-import.test.ts),
  [`comment-replies-worker.test.ts`](../packages/workers/test/comment-replies-worker.test.ts),
  [`analytics-rollup.test.ts`](../packages/workers/test/analytics-rollup.test.ts);
  on real Postgres the whole story plus the races
  ([`scripts/celebrity-looks-pg.ts`](../scripts/celebrity-looks-pg.ts),
  `pnpm looks:pg`, in CI).
- ✅ **Celebrity looks web (2026-09-30, stage 2, TEST data only).** `/shop`
  as the Spotted feed (trending row, filters, pager, empty state), the hub
  `/c/<slug>`, the look page piece by piece (numbered markers, none on a
  face; EXACT first, then similar styles; "Buy on Amazon.in" through `/r/`
  only, "See price on Amazon.in", the Associate statement beside every
  button; the non-endorsement line wherever a celebrity is named), the
  storefront `/s/<slug>` with share and QR, the withdrawn state (410 from
  `middleware.ts`), `/internal/revalidate`, `CELEBRITY_INDEXING`; the admin
  screens (Celebrities, Library, Looks + pieces editor, Takedowns, Instant
  links, Comment replies, Analytics with CSV) — [`spotted.test.ts`](../packages/web/test/spotted.test.ts),
  [`celebrity-web.test.ts`](../packages/web/test/celebrity-web.test.ts),
  [`celebrity-web-support.test.ts`](../packages/api/test/celebrity-web-support.test.ts);
  on a local stack and the installer's rehearsal
  ([runbook §1C](./runbooks/deploy.md) "What was checked").
- ✅ **Celebrity looks after three independent reviews (2026-09-30, TEST
  data only).** A name only in its own look's credit line (every other text
  checked against every name and alias when written and at every read:
  storefronts, event / place / piece labels, product text, Amazon shelves),
  name-free headlines, the product-text rule, the chain of title, a
  `street` / `other` place confirmed by the rights reviewer, asset licence
  facts widened only by the rights reviewer, a new image re-screened,
  EXACT links only after approval, look links on the web page's placement
  only, aliases resetting a review, links paused inside the review's and
  the minor flag's transaction, a restore that brings links back only where
  products are allowed, a celebrity takedown also withdrawing looks that
  name the person and listing stills and share URLs, 410 only for what was
  public, the still at its own address, the public API's rate limit and
  epoch cache, the Meta data deletion callback, fixed public comment
  answers, the webhook's `messages` field and a hidden verify token, the
  request log without query strings, batched revalidation, analytics
  summed in SQL for network admins and editors, the reply counts kept
  inside retention; the web's review fixes (the withdrawn page in the
  design, the label only with products, the editor's keyboard placing, the
  admin sub-navigation, the second editor's queue) —
  [`celebrity-controls.test.ts`](../packages/api/test/celebrity-controls.test.ts)
  and the suites above; `pnpm looks:pg` (with a race of a mint against a
  review turning products off).

## OUTSTANDING ENGINEERING

Code-side work still buildable in this repo; none of it has been run against
real infrastructure or real traffic yet:

- ⏳ Full backup/restore drill against **real Postgres**: restore a backup
  to a scratch host, run `node db/migrate.mjs --status` (must show 0001–0005
  applied, 0 pending), run `scripts/restore.sh`'s row-count and
  ledger-balance checks, record RPO/RTO. (`DEMO_TARGET=postgres` cannot be
  pointed at a restored database — it refuses one with migrations recorded
  because it asserts absolute row counts.) Open sub-items from
  [`scripts/ASSUMPTIONS.md`](../scripts/ASSUMPTIONS.md): WAL archiving /
  point-in-time recovery, encryption at rest + offsite copies, retention
  windows (needs counsel + finance sign-off).
- ⏳ **No real load soak has run.**
  [`scripts/load/redirect-soak.js`](../scripts/load/redirect-soak.js)
  exists and only ever ran against stubs; pg-mem numbers say nothing about
  the real hot path, and the docker smoke test above sent one click. Gates:
  `pnpm load:smoke` (50 rps, 30 s) PASS; `pnpm load:soak` (500 rps, 15 min)
  PASS with p95 < 150 ms service processing on `GET /r/{token}` and error
  rate < 0.1%; brief targets also include 99.9% redirect availability and
  p75 LCP ≤ 2.5 s on the PWA. It needs a real deployment
  ([`docs/infrastructure-recommendation.md`](./infrastructure-recommendation.md);
  the Linode exists, nothing is deployed on it); the estimate it must cover is in
  [`docs/capacity-plan.md`](./capacity-plan.md) (≈ 23–230 rps peak).
- ⏳ Vitest still runs on pg-mem. The migrations and the money loop are now
  proven on Postgres 16 (`pnpm demo:pg`, the seeds, the docker smoke), but
  the app code keeps its pg-mem-friendly query shapes (bare `ON CONFLICT DO
  NOTHING` + re-select, `IN (...)` expansion instead of `= ANY($array)`, no
  `LATERAL`, two-query pending bucket). Restoring targeted `ON CONFLICT
  (cols)` arbiters and running the suite itself on real Postgres are still
  open (README "pg-mem fidelity notes", `docs/threat-model.md` §4.5).
- ⏳ `clicks` partitioning by month (`docs/capacity-plan.md` §3): the table
  grows with every click and the retention purge nulls payloads but never
  removes rows. A `db/` migration decision.
- ⏳ Replace the JWT auth stub (`packages/api/src/middleware.ts`,
  `packages/api/scripts/mint-dev-token.mjs`) with a production IdP:
  self-minted tokens with unchecked `sub`/`org_id`/`role` are dev-grade —
  and the consumer shop's `WEB_API_TOKEN` is one of them today. (IdP
  *choice* is a human decision — [action tracker](./action-tracker.md); the
  wiring is engineering.)
- ⏳ **No signature verification** on the API webhook ingress
  (`POST /v1/integrations/:connector/events` currently trusts a platform
  JWT, which real merchants cannot hold). The HMAC-SHA256 pattern exists in
  the workers-side stub (`packages/workers/src/connectors/stub-network.ts`)
  — copy the pattern, don't ship the stub wiring.
- ⏳ Secrets-manager wiring: `JWT_SECRET`/`STUB_WEBHOOK_SECRET` and the
  Postgres password are dev placeholders (`.env.example`,
  `docker-compose.yml`); `docker-compose.prod.yml` reads them from the
  environment and nothing is wired to a vault yet.
- ⏳ Production CSV ingestion: move from inline `csv_text` (2 MB cap,
  whole file in API memory) to multipart or object-storage references.
- ⏳ **No rate limiting** on `/r/:token`, webhook, and CSV endpoints
  (`docs/threat-model.md` §4.8); CSP headers + token-storage hardening for
  the web app (§4.7). Bots hitting `/r/` today each write a `clicks` row.
- ⏳ Real-rail payout callbacks: signed callbacks + unknown-state requery
  discipline (already modelled in `payout-rail.ts`) once the fake
  `stub-network` rail is replaced.
- ⏳ Alert publishers: the metrics named in
  [`docs/monitoring/alerts.yaml`](./monitoring/alerts.yaml)
  (`click_observed_events_total`, conversion lag, settlement gap, ledger
  sweep) have no code emitting them yet; the `click-events` worker only
  logs. The pilot floor in `click-volume-drop` needs re-tuning against the
  capacity plan's estimate.
- ⏳ A `Cache-Control` policy for the shop so a CDN can front it (Next's
  dynamic default is no-store); LCP has never been measured.
- ⏳ **Backend for the Afflino screens that are demo today** (each page shows
  the "Demo data" badge until its endpoint exists; `packages/web/README.md`
  screen map):
  - Brand self-serve: brand accounts and workspaces, offer create / submit /
    edit / pause / end (`/brand/offers/new`, `/brand/offers`), the admin
    approval workflow that turns a submitted offer into a live programme
    (`/admin` review queue, `/admin/offers`), creator requests
    (approve / decline), brand-side conversion validation, billing and the
    wallet (`/brand/billing`; needs a payments provider).
  - Creator: a link listing endpoint (the "My links" table), report
    aggregates by day / offer / platform / city / sub-ID (`/app/reports`,
    the overview's clicks, conversions and chart), a creator-safe offers
    feed (`GET /v1/offers` returns the raw merchant `offer_url` to any
    signed-in role today, so the offer browser does not call it — restrict
    it first), applications for approval-gated offers, settings persistence
    (profile, payout method), a statement / ledger endpoint
    (`/app/payouts/statements`), payout history per publisher, a payee /
    payout-method endpoint (the Withdraw dialog names no destination until
    one exists), listing endpoints for the org's properties, programmes,
    offers and placements (the live mint form takes pasted uuids today),
    and a paid-to-date bucket in `GET /v1/publisher/earnings` (the overview
    shows "Unpaid earnings", pending + approved, because the approved
    bucket falls with every paid batch).
  - Publisher withdrawals: there is no publisher-initiated withdrawal;
    payouts are finance-prepared batches with maker-checker. Decide whether
    "Withdraw" becomes a request into the next batch.
  - Sign-in: OTP / an identity provider replacing the JWT stub (`/login` is a
    paste-a-token dev page; `/join`'s OTP accepts any 6 digits).
  - KYC / PAN verification (the PAN "Verified" line is a labelled demo),
    GSTIN verification (format only today).
  - Platform OAuth (Meta, YouTube, Snapchat) for connected accounts and
    audience figures (`/join` step 2, `/app/settings`).
  - Agency rosters: agency organisations, client workspaces, roster and the
    agency share (`/agency`, `/brand?workspace=`).
  - Admin: review-queue endpoints for offers, KYC and fraud; the fraud
    signals shown on `/admin/fraud` are demo — no fraud detection runs.
  - The design's readable `/r/{handle}/{offer}?s=` links and first-party
    attribution cookie are **not** implemented (the redirect mints
    `/r/{32-hex}` and sets no cookie); both are counsel-gated first
    (below), then engineering.
  - `GET /v1/publisher/earnings`: no next-payout date or threshold in the
    response (the overview's live "Next payout" is max(collected − payable,
    0) without them); its payable filter names a `cancelled` status the
    0001 migration does not allow.

- ⏳ Celebrity looks: alerting on the takedown SLA marks and on Meta's
  `messaging_policy_enforcement` deliveries (they reach the webhook; nothing
  alerts on them); a rate limit at the edge (the api's own per-process
  limit covers the public API and the Meta webhook, not `/r/` or the web's
  pages); a Hindi endorsement-wording list and Hindi page labels; a
  retention class for celebrity data once counsel sets it; a real identity
  provider so the rights reviewer and the second editor are people, not
  stub roles.

## EXTERNAL DEPENDENCIES

Items only a human can clear. Every row also appears in the
[action tracker](./action-tracker.md) with exact input, owner, dependency,
and acceptance criteria.

- 👤 Celebrity looks: counsel's capability matrix and wording (§10 Q1–Q30:
  incl. the web's placement of the non-endorsement line, the page labels,
  storefronts, trending and search indexing, the place kinds needing a
  confirmation, the public comment answers, analytics), a second editor for EXACT tags,
  a rights review with evidence per celebrity before anything about them is
  published, the library's chain of title (assignments and licences per
  batch), a 3-hour takedown contact, Amazon's view of links near a celebrity
  still, the Meta app (Business Verification, App Review with Advanced
  Access, Live mode; the webhook fields incl. `messages` and
  `messaging_policy_enforcement`; the data deletion callback URL; each
  Page's hybrid response mode; each Instagram account's message access),
  the privacy notice before comment replies, the reel / branded-content /
  boosted-post rules, a watch for court orders and the Delhi HC hearing,
  and celebrity data retention
  ([action tracker](./action-tracker.md) "Celebrity looks").
- 👤 Merchant programme approvals: signed insertion terms per pilot merchant
  (commission basis, attribution window, validation delay, payment terms,
  allowed domains). **No merchant programme exists today**; the only
  programme in any database is the TEST "Demo Network Programme" that
  `db/seed-network.ts --with-demo-programme` creates (`shop.example.com`).
  *A machine cannot sign commercial terms with a merchant.*
- 👤 Amazon.in Associates (2026-09-29): built and rehearsed with TEST values
  (`docs/runbooks/deploy.md` §1A); the owner's account, website list,
  tracking IDs, bio disclosures, counsel's privacy notice on `/privacy`
  (`amazon.sh links` and `shop` refuse until it is published), a real
  earnings download, Amazon's word on the `/r/` redirect and counsel's §9
  items are open — every one is a row of
  the [action tracker](./action-tracker.md) ("Amazon.in Associates").
  *Only the owner can join Amazon's programme; only Amazon and counsel can
  answer its open questions.*
- 👤 Channel exports: fresh 28/90-day audience + content-vertical exports
  from pilot publishers, on file before contracting. For the in-house
  network this is the owner's own platform analytics; the "12 billion views"
  figure in the capacity plan is the owner's statement ("our in-house views
  of 12b monthly"), not an export; which properties it covers is open
  (action tracker).
  *Only the publishers can provide their own data.*
- 👤 Counsel sign-off on every [DECISION] marker in
  [`docs/counsel-briefing.md`](./counsel-briefing.md): DPDP commencement map
  and build-now obligations, 90-day retention defensibility, data-principal
  rights workflows, minors policy, ASCI disclosure wording per format and
  sign-off process, celebrity image-rights assessment process and takedown
  timelines, publisher + merchant contract templates, principal-vs-agent
  determination, GST/tax mappings, publisher-funds holding characterisation,
  hosting jurisdiction, breach-notification mapping. *Only counsel can give
  legal answers; the "no cookies / hashed IPs" line above is an
  implementation detail for counsel to assess, not compliance evidence.*
- 👤 Media-rights assessment: pilot looks' asset licenses, territory, expiry
  dates recorded in `assets`; re-review queue empty; takedown workflow
  timelines from counsel. *Only a rights-holder review can clear celebrity
  imagery; owning footage ≠ advertising rights.*
- 👤 Infra provisioning: the owner chose Linode, created the server
  (172.105.52.150), pointed DNS at it (GoDaddy `A @`; no AAAA) and ran the
  first deploy on 2026-09-29 (`docs/runbooks/deploy.md` §1). Still open on
  it: off-server copies of the daily dumps and a restore check on the
  server, monitoring, optionally a Linode Cloud
  Firewall and Linode Backups (§6). Managed Postgres +
  Redis remain an option
  ([`docs/infrastructure-recommendation.md`](./infrastructure-recommendation.md);
  sizes to revisit per [`docs/capacity-plan.md`](./capacity-plan.md) §6).
  *Only the owner can change DNS and run the deploy on the server.*
- 👤 Load soak executed on a real deployment and results recorded. *The
  soak must run against real Postgres + Redis with real DNS and TLS in
  front, which only a human can stand up and approve for traffic.*
- 👤 Backup-restore drill evidence recorded on real Postgres, RPO/RTO
  declared. *Only a real cluster can produce real recovery numbers.*
- 👤 External pentest of the API + redirect surface, scoped per
  [`docs/threat-model.md` §5](./threat-model.md), scheduled or waived in
  writing. *Independent security testing cannot be done by the builders.*
- 👤 Payout rail: pilot payout account credentials in the vault; the fake
  `stub-network` rail replaced or explicitly approved for the pilot's money
  path; maker-checker roles assigned to real humans (`finance_operator` ≠
  `finance_approver`). The network seed's four role users are
  `<role>@afflino.invalid` placeholders until `SEED_*_EMAIL` supplies real
  addresses. *Only humans hold credentials and job titles.*
- 👤 Alerts wired: click-volume drop, redirect 5xx/p95, webhook backlog,
  settlement gap, books-balanced sweep on a schedule. *Only the operator of
  the real deployment can wire and validate alerting.*
- 👤 Kill-switch drill with the on-call rotation: pause + resume a canary
  programme, worst-case staleness under Redis best-effort documented.
  *Only the on-call rotation can rehearse an incident.*
- 👤 App-handoff / device matrix: in-app browsers, deferred deep links run
  before pilot traffic. *Only humans have the physical devices.*
- 👤 **Afflino placeholders to confirm** (all in
  `packages/web/lib/site-copy.ts`, printed on the site today as drawn): the
  audience claim (400M reach across Meta, YouTube, Snapchat), ₹0 upfront
  for brands, the T+7 creator payout cycle, prices (Starter ₹0/month,
  Network ₹24,999/month), network fees (15% / 8%), TDS 1% under section
  194-O (rate and section to be confirmed by the tax adviser), the 7-day
  validation window (3 / 7 / 14 in the builder), the ₹500 minimum
  withdrawal, the 15% default agency share, and the reading that a brand's
  budget cap covers creator payouts with the fee on top. *Only the business
  can commit to prices and claims.*
- 👤 **Disclosure wording**: the creator `#ad` line
  (`CREATOR_DISCLOSURE_LINE`) and the shop's disclosure (`SHOP_DISCLOSURE`)
  are drafts; counsel approves the wording and placement (action tracker,
  ASCI rows). The Creator Terms, Terms of use and Privacy notice pages are
  stubs, and `/contact` publishes no channel until launch. *Only counsel can
  approve disclosures and legal documents.*
- 👤 **Readable links + attribution cookie**: whether a first-party
  attribution cookie may be set at all (DPDP consent, ASCI) and whether
  readable `/r/{handle}/{offer}` links are acceptable — counsel first, then
  engineering. Until then offer copy says "attribution window", and the
  30 / 7-day windows it prints are placeholders (no window is implemented).
- 👤 **Providers for the demo flows**: SMS / OTP or identity provider, KYC /
  PAN verification, a payments provider for brand wallet top-ups, and
  developer access to the Meta, YouTube and Snapchat APIs. *Vendor choice
  and contracts are human decisions.*
