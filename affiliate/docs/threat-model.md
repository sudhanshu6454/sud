# Threat model & pre-pentest review — Paparazzi Affiliate Commerce Platform

Date: 2026-09-22. Scope: the sandbox codebase at this repo root (API, redirect
service, workers, the web app — creator / brand / agency areas, admin, shop —
DB migrations; web paths updated 2026-09-29 for the Afflino rebuild; the edge, TRUST_PROXY and IP_HASH_KEY added 2026-09-29; Amazon.in Associates added 2026-09-29: §1 items 5–5a, §3a, §3e, §4.12, §6.8). Grounded in code and
tests as they exist today — every mitigation claim cites a file or test.
Anything not implemented is marked **residual risk** (§4) or **open question**
(§6); §5 is the proposed pentest scope.

## 1. Trust boundaries

```
 [internet user]            [publisher / editor / finance human]
       |                                    |
       v                                    v
 edge (Caddy, docker/Caddyfile: the only public listener, 80/443; TLS for
       afflino.com + www only; overwrites X-Forwarded-For / X-Real-IP /
       Forwarded; security headers; no access log)
       |  /r/*                              |  everything else
       v                                    v
 GET /r/:token                    Afflino web app (Next.js, packages/web;
 (redirect service, :3001,         app areas call the API with a Bearer JWT
  UNAUTHENTICATED by design)       in localStorage, through the web's /api proxy)
       |                                    |
       +--> Redis route cache --------------+
       |    BullMQ click-events queue
       v
 API (Fastify, :3000, JWT auth + role matrix)
       |  webhook ingestion (stub connector + CSV upload, auth'd roles)
       |  finance endpoints (payout prepare/approve/disburse)
       v
 Postgres (tenant-scoped via tenantQuery) + Redis queues
       ^
 Workers (BullMQ: provider-events, click-events, reconciliation, retention)
```

Boundaries, in order of exposure:

1. **Public redirect path `GET /r/:token`** (`packages/redirect/src/index.ts`).
   Unauthenticated — the 32-hex token is the only capability. 128-bit
   unguessable bearer token, globally unique (`links.token text not null
   unique`, `db/migrations/0001_core.sql:190`). Token → route lookup is the
   one sanctioned cross-tenant read (documented exception; writes use the
   row's `org_id`). Raw IPs are never stored — `clicks.context.ip_hash`
   is HMAC-SHA256(`IP_HASH_KEY`, ip), or a plain SHA-256 when no key is set
   (`hashClientAddress`, `redirect/src/index.ts`); see §3a and §4.11.
2. **Creator app** (`packages/web/app/app/*`, formerly `/portal`) —
   authenticated, publisher-scoped views (earnings, links, payouts,
   statements, disputes). The brand and agency areas (`app/brand/*`,
   `app/agency/*`) call no API yet (TEST demo data).
3. **Admin area** (`packages/web/app/admin/*`, formerly `/console` —
   looks, suspense queue; the review pages are demo data) — staff roles.
4. **Finance endpoints** (`packages/api/src/routes/payouts.ts`,
   `suspense.ts`, `programmes.ts` pause/resume) — role-gated, maker-checker
   on payouts.
5. **Webhook ingestion** — `POST /v1/integrations/:connector/events`
   (`routes/integrations.ts`, allowlisted to `stub-network`, roles
   `network_admin`/`editor`), `POST /v1/integrations/csv/uploads`
   (`routes/csv-uploads.ts`, roles `network_admin`/`editor`) and, since
   2026-09-29, `POST /v1/integrations/amazon-associates/reports`
   (`routes/amazon-reports.ts`, the same roles) plus the operator CLI's
   `import-report` (`packages/api/src/cli/amazon.ts`, run on the server by
   `deploy/linode/amazon.sh import`). All funnel into one state machine
   (`src/conversion-ingest.ts`). The Amazon report is a file the owner
   downloaded from Associates Central: nothing signs it (§4.12). Only the
   report path writes Amazon rows: the CSV and webhook adapters answer 422
   for the Amazon programme, an Amazon account's `provider_account_id`
   (conversion or reversal) or a click ref of an Amazon link, and the
   shared ingest refuses a non-Amazon connector on them
   (`CONVERSION_PROGRAMME_CONNECTOR_MISMATCH`), so a generic upload can
   neither reverse an imported sale nor claim a future report key (review
   finding of 2026-09-29, reproduced then fixed; tested in
   `packages/api/test/amazon-report.test.ts`). One report import runs at a
   time per account (a session advisory lock, `src/amazon/report-import.ts`),
   and a return's reversal is inserted atomically (the conversion row
   locked, the remainder re-checked in the insert): concurrent imports once
   reversed up to 5× a sale's commission and landed a changed amount twice;
   `scripts/amazon-import-race.ts` (`pnpm race:pg`, CI) proves both on real
   Postgres.
5a. **Amazon's product API, outbound** (`packages/workers/src/amazon/`,
   since 2026-09-29): the workers call Amazon's Creators API with the
   owner's credentials (`AMAZON_CREATORS_CREDENTIAL_ID` / `_SECRET` in
   `/etc/afflino/afflino.env`, root 0600, passed to the workers only;
   entered at `amazon.sh keys`' hidden prompts). Only a price, its time and
   the stock status are written back (money parsed exactly from the
   decimal text; anything else → no price), shown for one hour at most. A
   429 pauses the account's refresh until Amazon's `retryAfterSeconds` (else
   the next UTC day), a 401 / 403 until the next UTC day
   (`amazon_associates_accounts.api_paused_until`).
6. **Workers/queues** (BullMQ on Redis): `provider-events`,
   `click-events`, `reconciliation`, `retention`. Not directly reachable
   from the internet; they trust the envelope hash and DB, not the caller.
7. **Database** — every API query goes through `tenantQuery`, which throws
   at runtime if the SQL does not reference `org_id`
   (`packages/api/src/db.ts`).
8. **Celebrity looks: the public read API** (2026-09-30,
   `packages/api/src/routes/public.ts`) — `GET /v1/public/:org/{spotted,
   trending, celebrities/:slug, looks/:id, storefronts/:slug, sitemap}`,
   UNAUTHENTICATED by design, public through the web's `/api` proxy. The
   organisation is its public slug (`orgBySlug`, the one unscoped read);
   everything after it is tenant-scoped. It serves only what the read gate
   allows at that moment (`readGateSql` / `publicLook`); never `offer_url`,
   evidence, reviewers, licence references or anything of a draft.
9. **Celebrity looks: the Meta webhook** (`routes/meta-webhook.ts`) — `GET`
   verification (the verify token, constant-time) and `POST` deliveries,
   UNAUTHENTICATED except for `X-Hub-Signature-256` over the raw bytes with
   `META_APP_SECRET`; public at `https://afflino.com/api/v1/integrations/meta/webhook`.
10. **The web's `/internal/revalidate`** (stage 2,
   `packages/web/app/internal/revalidate/route.ts`) — POST only, reached by
   the API over the compose network with `x-revalidate-secret` =
   `WEB_REVALIDATE_SECRET` (compared as HMACs, constant-time; 503 while the
   secret is unset or shorter than 16 characters; 401 otherwise; at most
   2000 tags, each one of the known cache-tag shapes, else 400). It can only
   make the web refetch public data sooner, never change it. The edge
   answers 404 for `/internal/*` (`docker/Caddyfile`; checked in the smoke
   test and the rehearsal).
11. **The web's middleware** (`packages/web/middleware.ts`, `/looks/*`,
   `/c/*`) — sends a HEAD to the public read API for the page's look or
   celebrity (2 s timeout) and answers 410 for a withdrawn one; it trusts
   only the API's status code; the path is reduced to a uuid or a slug
   before it is used (`withdrawalProbePath`). The 410's body is the web's
   own `/withdrawn` page fetched from `WEB_INTERNAL_ORIGIN` (default
   `http://127.0.0.1:$PORT`, the server itself; a fixed path, never a
   request-derived URL), with its scripts removed.

## 2. Assets

| Asset | Where | Why it matters |
|---|---|---|
| Double-entry ledger | `ledger_entries` (`db/migrations/0002_money_loop.sql`); math in `packages/shared/src/ledger.ts` | Money of record; append-only. Balance enforced per key (`assertEntriesBalanced`) and gate-checked before payout prepare (`assertBooksBalancedOrThrow`, `packages/api/src/finance.ts:572` → 409 `LEDGER_IMBALANCE`) |
| Payout batches / transfers | `payout_batches`, `payout_items`, `payout_transfers` (`0002_money_loop.sql`) | Real money movement; maker-checker + idempotent disburse |
| PII: publisher KYC | `publishers.legal_name`, `users.email` (`0001_core.sql`); consent evidence in `consent_records` (`0001_core.sql:309`); raw click/provider payloads (`clicks.context`, `conversions.raw`) aged out by the retention purge | DPDP exposure; raw blobs nulled by `packages/workers/src/retention/purge.ts`, never the ledger/audit rows |
| Click/conversion evidence | `clicks`, `conversions`, `adjustments`, `outbox` | Attribution & dispute evidence; raw payloads are the suspense reviewer's evidence |
| Credentials/secrets | `JWT_SECRET`, `STUB_WEBHOOK_SECRET`, `DATABASE_URL`, `REDIS_URL` (`.env.example`, `docker-compose.yml`) | Dev placeholders today; compromise = full tenant impersonation |
| Audit trail | `audit_log` (kill-switch pulls, suspense attribution/review, retention runs) | Non-repudiation for finance ops; never purged (`purge.ts`) |

## 3. Per-component STRIDE analysis (mitigations are implemented, with refs)

### 3a. Redirect service (`packages/redirect/src/index.ts`)

- **Spoofing (S)** — token is 128-bit random hex (`TOKEN_RE = /^[0-9a-f]{32}$/`);
  anything else → 404 without touching the DB. No session, no login on this
  path. _Residual:_ token in URLs leaks via referer/logs if a destination
  page loads third-party resources.
- **Tampering (T)** — route payload is server-read (Redis → DB fallback);
  the client supplies nothing but the token. **Open-redirect guard:**
  destination hostname must be in the programme's `allowed_domains`, else
  403 fail-closed (`index.ts` step 4). Link minting enforces the same
  allow-list at creation (`routes/links.ts` — un-allow-listed offer URL →
  403 `PROGRAMME_NOT_APPROVED`).
- **Repudiation (R)** — every click insert carries `click_id` (uuid),
  `org_id`, timestamp, `ip_hash`; `click.observed` envelope enqueued to
  BullMQ. **Fail-open design (deliberate):** if persistence fails the user
  is still 302'd to the approved destination *without* a subid, and the loss
  is error-logged (`index.ts` step 5). Trade-off: a DB outage converts to
  unattributable traffic (conversions later land in suspense), never to a
  broken user journey or a fabricated attribution.
- **Info disclosure (I)** — no cookies read or written anywhere on the click
  path; consent-denial test asserts `set-cookie` is absent on both link-mint
  and redirect responses (`packages/api/test/phase3.test.ts:407`).
  Implementation detail for counsel to assess — whether this posture satisfies
  DPDP consent obligations is for counsel to determine.
  **Client address (2026-09-29).** Which address is hashed is decided by
  `TRUST_PROXY` (unset = trust nothing; `packages/shared/src/trust-proxy.ts`):
  docker-compose.prod.yml sets `loopback,uniquelocal`: api and redirect
  trust X-Forwarded-For from loopback and any private-range peer. The only
  such peers are the stack's own containers (the web's /api proxy) and
  Docker's proxy for the 127.0.0.1-published ports, which is how the
  host-networked edge — and any process on the server itself — reaches
  them; nothing outside the server can connect to those ports. The edge
  overwrites any client-supplied X-Forwarded-For / X-Real-IP / Forwarded
  with the address it saw (`docker/Caddyfile`). A shopper therefore
  cannot choose their `ip_hash` (tested: `packages/redirect/test/client-ip.test.ts`;
  end to end through the edge in `docker/README.md`). The hash is keyed with
  `IP_HASH_KEY` when set: an unsalted SHA-256 of an IPv4 address is reversible
  by enumerating 2^32 values in minutes, an HMAC without the key is not. The
  stored value is still a stable pseudonymous identifier per address, i.e.
  still data for counsel to assess, not an anonymisation claim (§4.11). The
  api and redirect request logs carry no client address (`requestLogFields`,
  `packages/shared/src/request-log.ts`) and the edge writes no access log;
  its error log drops the address and request headers.
  Unknown/paused tokens serve a static paused page (200, `text/html`, no
  user input → no reflected XSS surface).
- **Amazon.in destinations (2026-09-29)** — for an Amazon programme the
  stored offer URL is exactly `https://www.amazon.in/dp/<ASIN>` (checked at
  mint); the redirect strips `tag`, `ascsubtag` and `subid` and sets `tag`
  to the placement's tracking ID (else the store ID), so a stale tag or a
  per-click id never rides along — and **no click id is ever added** (LR:
  "Under no circumstances may you associate any sub-tag with a specific end
  user"; the sub-tag setting was removed on review). The tag survives a
  failed click insert (fail-open). Named link-preview crawlers, generic
  bot / crawler / headless / HTTP-library user agents, a missing user
  agent, prefetch / prerender / preview requests and `HEAD` get the preview
  page (no click, no tagged URL; PR 25 / 27), every `/r/` response says
  `X-Robots-Tag: noindex, nofollow`, robots.txt disallows `/r/` when the site
  is open to search engines. The account's `status`, the property's approval,
  its `owner_operated` verification and its platform (Facebook, Instagram or
  web only) are re-checked on the DB fallback: any of them failing serves the
  paused page. Tested: `packages/api/test/amazon-links.test.ts`.
- **DoS (D)** — Redis route cache (300s TTL) absorbs the hot path; DB is
  the fallback. Token regex rejects junk before any I/O. _Residual:_ no
  rate limiting observed on `/r/:token` — cache-miss floods hit Postgres
  directly; Redis outage degrades to DB-every-click.
- **Elevation (E)** — n/a (no privileges on this path). The pause kill
  switch (`POST /v1/programmes/:id/pause`, `network_admin` only,
  `routes/programmes.ts`) flips eligibility and invalidates `route:{token}`
  cache entries after the commit, and again 2 s later (a redirect whose DB
  read was in flight at the commit can re-cache the old status; the second
  delete clears it; a read-to-SET gap over 2 s or an api restart in that
  window remains, bounded by the 300 s TTL — packages/api/ASSUMPTIONS.md);
  redirect treats `programme_status != 'active'` as ineligible. Tested
  end-to-end (`phase3.test.ts` "programme kill switch").

### 3b. API auth & tenant isolation (`middleware.ts`, `db.ts`)

- **S** — Bearer JWT verified with `JWT_SECRET` (fail-fast if unset).
  Required claims `sub`/`org_id`/`role` type-checked. Role matrix per route
  (`requireRole`): e.g. payout prepare `finance_operator`/`finance_approver`/
  `network_admin`; approve drops `finance_operator` (maker-checker);
  suspense ops limited to finance roles; CSV/webhook to
  `network_admin`/`editor`.
- **E** — tenant isolation is structural: `tenantQuery` *throws* unless the
  SQL references `org_id`, and `$1` is always the caller's org
  (`packages/api/src/db.ts`). Tested: org A cannot read org B's earnings
  (404), mint links on B's property (403 `PROPERTY_FORBIDDEN`), or use B's
  offer (scoped lookup) — `packages/api/test/phase3.test.ts:225-...`
  ("tenant isolation"); suspense list/retry/review 404 on other orgs' rows
  (`packages/api/test/suspense-ops.test.ts:353,397,506`). One sanctioned
  exception: token-only route lookup in the redirect service (see §3a).
- **R** — `X-Request-Id` on every response; finance mutations write
  `audit_log` (kill switch, suspense attribution/review, retention runs).
- **I** — error envelope is `apiError(code, message, requestId)` — no
  stack traces or SQL in responses (see `_helpers.ts` `parseOr400`, route
  error paths).

### 3c. Money path: webhook + CSV ingestion (`conversion-ingest.ts`, `integrations.ts`, `csv-uploads.ts`)

Both shapes run through **one** state machine (`ingestConversionEvent`).

- **T (replay/double-post)** — idempotency on the provider natural key:
  `unique nulls not distinct (provider_account_id, source_transaction_id,
  line_id)` (`0001_core.sql:230-231`). Repeat at same/lower
  `provider_revision` → `deduped` no-op. Ledger re-posting is impossible
  through the `(idempotency_key, account)` unique key
  (`0002_money_loop.sql:62`). Header-level `Idempotency-Key` replays stored
  responses (`src/idempotency.ts`); caveat: no request fingerprinting — same
  key + different body replays the first response (documented TODO).
  Tested: 10 identical webhooks → 1 conversion, 3 ledger entries
  (`money-loop.test.ts:253`); duplicate full-file CSV upload → one
  financial effect (`csv-connector.test.ts:265`).
- **T (status games)** — revision-ordered machine: stale revisions ignored;
  `approved` is terminal for the status column — a higher-revision
  `pending` is logged and ignored, a higher-revision `declined`/`reversed`
  creates a reversal **adjustment** for the unreversed remainder (never an
  in-place flip), with deterministic adjustment ids so retried reversals
  stay idempotent (`conversion-ingest.ts` `autoReverse`). Tested
  (`money-loop.test.ts:269-...`, `csv-connector.test.ts:325`).
- **T (misattribution)** — **no-auto-attribution rule, enforced in code:**
  unknown `returned_click_ref` → `click_id = NULL` (suspense), never a
  guess (`conversion-ingest.ts` §1; `packages/workers/src/suspense.ts`
  read-model). Suspense retry binds a click **only on exact
  `clicks.click_id = returned_click_ref` equality** — no LIKE, no
  timestamp/IP correlation; NULL ref → 422
  (`routes/suspense.ts`, policy banner). Concurrent retries can't
  double-bind (re-check `click_id IS NULL` inside the transaction).
  Review (`/review`) touches `reviewed_*` columns only — never changes
  attribution, never posts ledger. Tested:
  `suspense-ops.test.ts:365,385,397,440,473`.
- **T (malformed input)** — CSV: 2 MB cap (`MAX_CSV_BYTES`), RFC-4180
  parser, **all-or-nothing validation** — any invalid row → 422 and zero
  inserts (`csv-uploads.ts`; tested `csv-connector.test.ts:296`). Money is
  integer minor units; decimals rejected, not rounded. Uploads require an
  **active** programme named by the uploader; webhook events fail closed
  with 422 when no programme resolves (`CONVERSION_PROGRAMME_UNKNOWN`).
- **I** — webhook route allowlists connectors (`stub-network` only);
  `raw` provider payloads are surfaced to suspense reviewers as evidence
  (the admin suspense queue renders them JSON-escaped in a `<pre>`,
  `packages/web/app/admin/suspense/SuspenseQueue.tsx:157`).
- **D** — 2 MB CSV cap; webhook bodies are small JSON. _Residual:_ no
  request rate limits on ingestion endpoints.

### 3d. Payouts (`routes/payouts.ts`, `payout-rail.ts`, `finance.ts`)

- **E (maker-checker)** — preparer cannot approve their own batch:
  `batch.prepared_by === tenant.sub` → 403
  (`routes/payouts.ts` approve handler). Tested
  (`money-loop.test.ts:525-536`). Role split: prepare
  (`finance_operator`+), approve (`finance_approver`/`network_admin`),
  disburse (`finance_operator`/`network_admin`). Approve/disburse enforce
  status machines (`pending_approval` → `approved` → `processing` → `paid`/
  `failed`; wrong state → 409).
- **T (double-payout)** — batch row idempotency key
  (`on conflict do nothing` → return existing, 200 `deduped:true`);
  transfer rows keyed `transfer:<batch_id>:<publisher_id>`; disburse
  re-call collapses on the key and the rail skips transfers past
  `initiated`. **Unknown-state guard:** re-initiating a transfer stuck in
  `unknown` throws `TRANSFER_STATUS_UNKNOWN` (409) unless
  `queryTransferStatus` ran within 5 minutes — no blind resubmits at a real
  rail (`payout-rail.ts`).
- **T (paying uncollected money)** — prepare caps payouts by collected
  cash: per-(programme, currency) `merchant_settlements` allocated pro-rata
  by eligible-earnings share, minus live batches, minus the publisher's
  max-contract threshold (`computeCollectedAllocation`,
  `computeEligibleEarnings`, `finance.ts`; gate: books must balance or 409
  `LEDGER_IMBALANCE`). Ledger payout entries post only when the batch
  reaches `paid` via provider callback.
- **S (callback trust)** — `POST
  /v1/integrations/stub-network/payout-callback` is `network_admin`-only
  today; the stub trusts the caller's outcome. **This is sandbox-only** —
  a real rail needs signed callbacks (open question §6).

### 3e. Link minting guards (`routes/links.ts`)

`POST /v1/links` enforces, all tenant-scoped: property approved (else 403
`PROPERTY_FORBIDDEN`), publisher onboarding `active` (else 403
`PUBLISHER_NOT_ACTIVE`), programme active (else 403
`PROGRAMME_NOT_APPROVED`), offer active + fresh (else 422 `OFFER_STALE`),
offer destination host in programme `allowed_domains` (else 403). Token
HMAC uses `route_signature` — **dev-grade: reuses `JWT_SECRET`**
(`links.ts:33`, TODO: KMS-managed key). Tested in `phase3.test.ts`
(link-creation guards section). Since 2026-09-29, for every programme: the
offer must belong to the named programme and the placement to the named
property, in a campaign of that property's own publisher (before, the four
ids were not cross-checked). For an Amazon programme also: the account
active, the placement in the programme's own campaign (only pages the setup
declared have one), the property on Facebook, Instagram or the owner's
website (403 `PROPERTY_FORBIDDEN` for Snapchat, Telegram and the rest), the
property with a live `owner_operated` verification — always: no setting
allows third parties (403 `PROPERTY_NOT_OWNER_OPERATED`; PR 9) — and the
canonical `/dp/<ASIN>` URL (tested:
`packages/api/test/amazon-links.test.ts`). The operator's link sheet
(`amazon.sh links`) mints through this same route in-process
(`packages/api/src/amazon/links.ts`), as a short-lived `network_admin`
token that never leaves the process.

### 3f. Workers / queues (`packages/workers/src`)

- **T** — `provider-events` worker verifies envelope integrity
  (`hashPayload` vs `payload_hash`) and drops tampered envelopes, writing
  nothing (`packages/workers/test/provider-events.test.ts:122`). It keeps
  its **own copy** of the ingest state machine (deliberate: runs off the
  queue, not the API — `conversion-ingest.ts` header warns not to "fix" it
  from the API side); both post via the same ledger builders/idempotency
  keys so double-posting is impossible (`ledger-mirror.ts`).
- **I** — retention purge nulls `clicks.context`, `conversions.raw`, and
  published outbox rows per env-configured windows; **never touches**
  `ledger_entries`, `audit_log`, `adjustments` (tested
  `retention.test.ts:263`); statements stay reproducible from ledger data
  after purge (`retention.test.ts:328`). Purge is per-org, transactional,
  and self-auditing (`actor_id = NULL`, machine-readable entity_id).
- **D** — BullMQ `removeOnComplete/removeOnFail` caps on click-event jobs.

### 3h. Celebrity looks, takedowns, comment replies (0007, 2026-09-30)

- **Rights-gate bypass attempts** — every public list filters in SQL
  (`readGateSql`: published, no takedown on look or celebrity, not a minor /
  never-listed, a publishable status, a review allowing the name) and every
  look is masked in JS (`publicLook`: name, image, products, pending EXACT);
  the legacy catalogue never serves a celebrity look to a consumer role
  (`routes/looks.ts`; `celebrity-looks.test.ts`); the editorial routes need
  network_admin / editor (reads: + rights_reviewer); only `rights_reviewer`
  sets a status beyond `blocked` or restores a takedown (403, tested); a minor
  can never leave unreviewed / blocked (a CHECK); EXACT needs evidence and a
  second person (API 403 + a CHECK). A downgrade, an expiry or a takedown is
  effective at the next read. Weak point: the JWT stub (§4.1) — whoever holds
  `JWT_SECRET` can mint a `rights_reviewer` token.
- **Takedown** — one transaction (looks locked, withdrawn, links paused,
  reply rules off, queued replies cancelled, snapshot, audit, outbox), then
  the route keys deleted twice and the web revalidated; mints serialise on the
  look's row lock (10 racing rounds on real Postgres, never an active link on
  a withdrawn look). Timestamps received / actioned / completed; SLA marks
  (warn > 60 min, breach > 180 min) are computed, not alarmed (§4.13).
- **Webhook (S, T, R)** — signature over the raw body (a re-serialised body
  fails, tested), 503 while unconfigured, 401 on a bad or missing signature
  before anything is read; the verify token compared in constant time and the
  challenge echoed only as a short token (no reflected markup).
  **Replay / D** — Meta retries for 36 hours: `unique (platform, comment_id)`
  makes every repeat a no-op (10 concurrent deliveries → one event on real
  Postgres); a body cap of 5 MB; a per-client token bucket
  (`WEBHOOK_RATE_PER_MINUTE`, default 1200 a minute; Meta retries a refused
  delivery for 36 hours), in the api process, not at the edge (§4.8).
- **PII (I)** — no comment text, username or raw commenter id is stored:
  `HMAC-SHA256(COMMENT_ID_HASH_KEY, platform:account:id)` only (tested by
  scanning every stored row); events deleted after 30 days (placeholder);
  Page tokens only in the workers' memory.
- **Message content (T)** — the private reply is built and re-checked
  (`replyTextRefusal`) right before the send: only `SITE_URL/looks/<uuid>`
  (or `/s/<slug>`), https, no query, no second URL, no `/r/`, no merchant
  host, ≤ 1000 bytes; a misconfigured `SITE_URL` fails closed (tested).
  One message per comment: a conditional claim; an unknown outcome is never
  resent.
- **Stage 2 additions (the web and the owner's steps)** —
  **Public trending and facets (I)**: `trending` ranks by `click_daily` but
  returns only look cards through the same read gate (no click counts);
  `facets` lists only celebrities with a public look and live storefronts,
  through the gate (a takedown empties both, tested in
  `celebrity-web-support.test.ts`). **The web's link guard (T)**:
  `lib/spotted.ts` renders a product's button only for
  `https?://host/r/<32 hex>` and a post link only for an https Facebook /
  Instagram URL; anything else becomes the disabled control (tested), so a
  bad row cannot put a merchant or foreign URL on the page. **Library upload
  in the admin (T, D)**: `POST /v1/editorial/library/import`, editors only,
  `csv_text` ≤ 900 000 characters, a dry run by default, the same checks as
  the server-side import (a whole file refused on one bad row, the advisory
  lock, idempotent). **Reply events (I)**: `GET /v1/replies/events` and
  `looks.sh events` never return the comment id, the commenter hash, the
  media id or the message id (tested). **The admin sign-in (S)**:
  `looks.sh signin` mints an 8-hour JWT-stub bearer for the network admin,
  the rights reviewer or the second editor, writes it to
  `/etc/afflino/admin-sign-in.token` (root, 0600) and never prints it; the
  owner's Mac line copies it to the clipboard. It is as strong as the stub
  (§4.1). **The Meta verify token** is one the owner makes up and types at a
  hidden prompt (`looks.sh keys`) and again in Meta's dashboard; nothing
  prints it (`looks.sh webhook` shows only the fields and addresses), and
  the api's and the redirect's request logs record the path without its
  query string (the token travels in the GET's query; tested,
  `request-log.test.ts`, `celebrity-controls.test.ts`). It only completes
  the GET handshake — every delivery is authenticated by the app secret.
- **After three independent reviews (2026-09-30)** —
  **Names (I, T)**: a celebrity's name appears only in the credit line of
  that person's own look and hub; every other text (event, place, piece
  labels, product brand / model / category, a storefront's name / slug /
  bio, an Amazon shelf's title) is checked against every celebrity's name
  and aliases when written (422) and again at every read (the look 404s,
  the product or storefront is left out), so a later alias or a takedown
  also hides text written before (`celebrity-controls.test.ts`). The
  headline is name-free ("Spotted at <event>"). **The still's own address
  (I, SSRF)**: pages point at `/img/looks/<id>`; the web asks
  `GET /v1/public/{org}/looks/{id}/still`, which re-applies every rule and
  fetches the origin file (`src/looks/still.ts`: https only in production,
  no loopback / private / `.internal` / `.local` host, no credentials in
  the URL, no redirect followed, 8 s, 12 MB, image types only; the origin
  URL is written only by the library import and editors) and never returns
  its address; 410 after a takedown of a look that was public. Residual: a
  DNS name that resolves to a private address is not caught (the check is
  on the host name; the origin URLs are the owner's own). **Rate limit and
  cache (D)**: `src/public-guard.ts` — a per-client token bucket on
  `/v1/public/*` (`PUBLIC_RATE_PER_MINUTE`, 240) and the Meta POSTs, keyed
  by an HMAC of `req.ip` in memory only; the web's own server-side calls
  (no X-Forwarded-For from a private peer) are not counted, so one busy
  client cannot put the whole site into 429 through the web's shared
  address; public answers and stills are cached 30 s per process under a
  Redis epoch every invalidation increments (a takedown drops them at
  once; stills within a 64 MB budget, keyed by the look so a made-up
  `?v=` cannot force an origin fetch). **Meta data deletion (S)**: `POST
  /v1/integrations/meta/data-deletion` verifies `signed_request`
  (HMAC-SHA256 with the app secret, constant time, 401 otherwise; 503
  unconfigured), deletes that person's reply events on every in-house
  account (the org of each account resolved first, then tenant-scoped
  deletes), keeps the opt-out hash, logs only counts. **Maker-checker
  (T)**: a tracked link of a piece's product is minted only for an approved
  item (409 otherwise), under the look's row lock, for the look's web page
  only (a post's placement never appears on afflino.com). **Asset licence
  facts (T)**: widening one (commercial reuse, territory, expiry, the chain
  of title, clearing a frame flag) needs the rights reviewer (403 for an
  editor; the frame flags cannot be cleared at all), audited; a new image
  address resets the frame screen.

### 3g. Web app (`packages/web`)

- No `dangerouslySetInnerHTML` anywhere (verified by grep); React escapes
  all rendered values including suspense `raw` payloads and review notes.
- Auth token lives in **`localStorage`** (`paparazzi_token`, read in
  `packages/web/lib/api.ts`, written by `/login`) — any XSS would
  exfiltrate the bearer (residual risk; §4). The other `afflino_*` keys
  hold demo state only, no secrets.
- App pages fall back to **demo/mock data** (`withDemoFallback`,
  `lib/demo/*`, `portal-demo.ts`, `DemoBadge`) when the API is unreachable,
  and pages with no endpoint always show TEST data with the badge —
  operators must be trained that demo data is not evidence.

## 4. Residual risks (implemented gaps — fix before any shared environment)

1. **JWT auth stub** (`packages/api/src/middleware.ts`): self-minted tokens
   whose `sub`/`org_id`/`role` are trusted without a memberships-table
   check; no central expiry/issuer/audience validation (TODO in code).
   Anyone holding `JWT_SECRET` can mint any role in any org. Replace with a
   production IdP before pilot users touch it.
2. **No provider-payload signature verification on the API webhook
   ingress.** `POST /v1/integrations/:connector/events` authenticates with a
   *platform* JWT (`network_admin`/`editor`) — real merchants can't hold
   one. HMAC-SHA256 verification (`timingSafeEqual`) exists only in the
   workers-side stub demo (`packages/workers/src/connectors/stub-network.ts`
   `handleWebhook`) — the pattern to copy, not the wiring. Production
   needs per-connector signing (secret per provider account, rotation) on
   the ingress path.
3. **CSV upload is an inline string** (`csv_text`, 2 MB cap) — deliberate
   sandbox simplification (`csv-uploads.ts` body-schema note). Production
   wants multipart or object-storage references; the current shape also
   keeps whole files in API memory.
4. **Secrets are dev placeholders**: `JWT_SECRET`/`STUB_WEBHOOK_SECRET` =
   `dev-only-change-me` (`.env.example`), Postgres password default
   `changeme` (`docker-compose.yml`). No secret manager wiring.
5. **pg-mem ≠ Postgres.** The test DB rewrites `unique nulls not distinct`
   → plain `unique` (NULLs become distinct), drops column-targeted
   `ON CONFLICT` arbiters, shims timestamp casts and `gen_random_uuid`
   (`packages/api/test/pgmem.ts` — documented, but every shim is a
   behaviour the tests *cannot* verify). The 57/57 green run proves logic,
   not Postgres semantics; a real-Postgres soak is still required.
6. **Retention windows are counsel placeholders**: 365-day sandbox
   defaults in `packages/workers/src/retention/config.ts`, env-overridable,
   with fail-closed-to-default on misconfiguration. Counsel has not set the
   real windows (see `docs/counsel-briefing.md` §1).
7. **XSS → token theft**: `localStorage` Bearer <redacted> + **no CSP**
   (the edge sets HSTS, nosniff, Referrer-Policy and X-Frame-Options DENY,
   `docker/Caddyfile`, but deliberately no Content-Security-Policy yet: one
   has to be written against the Next.js bundle and tested); React escaping
   is the only XSS control.
8. **No rate limiting** on `/r/:token` or the CSV endpoint, and none at the
   edge; the public read API and the Meta webhook have a per-process,
   per-client token bucket in the api (2026-09-30, `src/public-guard.ts`;
   several replicas each keep their own, and many users behind one carrier
   NAT address share one bucket — 240 a minute for the public reads). Redis
   outage degrades the click path to DB-per-click and turns the public
   answer cache off.
9. **Payout callback trust**: stub trusts the caller's `outcome`; real rail
   needs signed callbacks + the unknown-state requery discipline already
   modelled in `payout-rail.ts`.
10. **`tenantQuery`'s org check is a regex** (`/\borg_id\b/`) — it catches
    accidents, not adversaries (a string literal containing "org_id" would
    pass). It's a safety net over code review, not a security boundary.
11. **Click `ip_hash` is pseudonymous, not anonymous** (2026-09-29). Without
    `IP_HASH_KEY` it is SHA-256(ip), reversible for IPv4 by enumeration —
    rows written before a key was set stay that way until the retention
    purge nulls `clicks.context`. With the key it is HMAC-SHA256(key, ip):
    not reversible without the key, but anyone holding the key can test a
    known address, and the value is stable per address (that is what makes
    per-address fraud checks work). Key custody (who holds it, where it is
    stored), rotation (a new key breaks comparison with older rows) and
    whether a hashed address is personal data under DPDP are **counsel
    items**, not claims (docs/counsel-briefing.md). Deployment note: Docker
    rewrites the source address of connections it forwards through its
    userland proxy (IPv6 to an IPv4-only compose network, hairpin
    connections), so every such client would hash to the network gateway;
    the production edge therefore runs with host networking
    (`docker/ASSUMPTIONS.md` item 19) and sees each client's own IPv4 or
    IPv6 address, which is what allows the AAAA record. (Verified for IPv4
    in the sandbox; IPv6 follows from the edge owning the socket and is not
    tested there.)

12. **Amazon.in Associates (2026-09-29).** (a) The Store ID and tracking
    IDs are public by nature (every Amazon URL the redirect sends carries
    one): anyone can craft an amazon.in URL with the owner's tag outside
    this system, and Amazon holds the account responsible for traffic it
    "authorizes, assists, encourages, or facilitates" (OA §16); the defence
    is the owner watching Amazon's Tracking ID and Link-Type reports. (b)
    The earnings report is an unsigned file: whoever can run `amazon.sh
    import` (root on the server) or holds a `network_admin` / `editor`
    token can create approved conversions and ledger entries. Mitigations:
    the role gate, idempotent keys, a changed amount refused (409, nothing
    written), maker-checker on payouts, and payout eligibility capped by
    collected cash (no `merchant_settlements` are written for Amazon yet,
    so nothing becomes payable). (c) The shop's `WEB_API_TOKEN` minted by
    `amazon.sh shop` is the 365-day JWT stub (read-only role), and the
    Creators API secret sits in plain text in the 0600 environment file:
    no secret manager (§6.5). (d) The automated-client list is a
    heuristic (named previewers, generic bot / crawl / spider / preview /
    headless tokens, HTTP libraries, no user agent, prefetch headers): a
    bot that sends a browser's user agent still creates a click and an
    Amazon session (PR 27). (e) The `/r/` redirect itself is a
    "Redirecting Link" (OA §7) whose acceptability is Amazon's call
    (`docs/action-tracker.md`, "The `/r/` redirect"). (f) The operator's
    explicit reversal (`POST /v1/integrations/:connector/events`
    kind=reversal) and the provider auto-reversal still read the remainder
    and insert in two steps: only the Amazon return path (import and
    `apply-return`) takes the conversion row lock; concurrent generic
    reversals of one conversion remain a pre-existing gap (they cannot reach
    Amazon rows).

13. **Celebrity looks (2026-09-30).** (a) The takedown SLA marks are not
    wired to an alert (only `GET /v1/takedowns` and `looks.sh takedowns`
    show them). (b) The public API and the Meta webhook are rate-limited in
    the api only (§4.8); the public answers may be cached downstream for
    30 s, so a takedown reaches such a cache within that bound (the web's own
    caches are revalidated; the api's own cache is dropped at once by the
    epoch). A flood of made-up look ids or pages through the web is not
    limited (the web's server-side calls are not counted; the edge has no
    limit). (c) The web revalidation is
    best-effort (a failed call is logged; pages then expire by their cache
    time). (d) The endorsement-wording check is English only and cannot read
    text inside images. (e) A Facebook user's comment id and message PSID may
    differ: a "STOP" message may not suppress a later comment (Meta /
    counsel). (f) The CLI records counsel's decisions as a placeholder
    rights-reviewer user on the server (root on the Linode is trusted with
    that), and the second editor's sign-in is a placeholder user too; the
    API's role separation is intact, but the stub cannot tell two people
    apart, so the EXACT maker-checker is only as good as the owner handing
    each sign-in to its person. (g) The web's 410 lags a takedown by up to
    5 s per web process (the middleware keeps "not withdrawn" 5 s; the page
    itself shows only the withdrawn notice at once, revalidated). (h) The
    sign-in file holds a live 8-hour bearer on the server, and the Mac's
    clipboard keeps it until overwritten (a clipboard manager may keep it
    longer); a new sign-in replaces the file but does not revoke the old
    token (no revocation in the stub). (i) The public read API's answers
    are public by design; enumeration of look ids is bounded by uuids, and
    of celebrity slugs by the read gate (an unreviewed or blocked slug is a
    404 like an unknown one).

## 5. Proposed pentest scope

**In scope**
- Redirect service: token brute-force resistance, open-redirect bypass
  (allow-list edge cases: subdomains, punycode, `user@host`, ports),
  cache-poisoning across pause/resume, click-path cookie/header audit,
  cache-miss DoS behaviour.
- API authorization matrix: every route × every role (focus: payout
  approve/disburse, suspense retry/review, programme pause/resume, CSV
  upload, webhook events); cross-org access on every id parameter;
  `tenantQuery` bypass attempts.
- Webhook idempotency & replay: duplicate/out-of-order revisions,
  approved→pending downgrade attempts, double-reversal, natural-key
  collisions with NULL vs empty `line_id`.
- Payout maker-checker bypass: self-approval, role confusion, batch
  state-machine jumps (approve→approve, disburse→disburse, disburse before
  approve), transfer idempotency-key collisions, `unknown`-state
  resubmission.
- Tenant isolation: org A's token against org B's publishers, links,
  earnings, suspense rows, payout batches.
- CSV: malformed/oversized input, header tricks (duplicates, case,
  BOM), formula-injection payloads (`=cmd|...`) through validation and
  into the suspense console rendering, 2 MB boundary, all-or-nothing
  atomicity under partial failure.
- XSS: stored payloads — review notes (10–2000 chars), dispute text,
  `conversions.raw` rendered in the suspense console, link/offer fields —
  in portal and console; token exfiltration via `localStorage`.
- JWT: algorithm confusion, `none` alg, weak-secret brute force, claim
  tampering (`role` escalation, `org_id` swap), missing-claim handling.
- Celebrity looks (2026-09-30): the rights gate on every public read
  (`/v1/public/{org}/…`: an unreviewed, blocked, withdrawn or minor
  celebrity through every list, the trending row, the facets, the
  sitemap), the EXACT maker-checker (a tagger approving through another
  role), the takedown → 410 path (the web's middleware and pages, the
  revalidation), `/internal/revalidate` reached from outside the compose
  network (the edge's 404, header tricks, the secret), the Meta webhook's
  signature and replay handling, the admin's library upload (size,
  formula payloads, endorsement words), the web's link guard (a non-`/r/`
  or foreign URL reaching a button).

**Out of scope**
- Social engineering / phishing of staff or publishers.
- Physical security.
- Third-party merchant / affiliate-network systems (only the stub
  connector is in scope).
- DoS beyond rate-limit absence verification (no volumetric testing).
- The demo/mock-data mode of the web app.

## 6. Open questions for humans

1. **Auth provider**: which IdP (and token shape) replaces the JWT stub?
   Who owns the `sub → (org_id, role)` membership mapping the middleware
   TODO calls for?
2. **Webhook signing for real connectors**: HMAC shared-secret per
   provider account (extend the `stub-network.ts handleWebhook` pattern to
   the API ingress), mTLS, or provider-specific schemes? Key rotation
   story?
3. **Payout rail**: which provider (RazorpayX / bank file / other)? Trust
   model for provider callbacks — signed webhooks? Polling with the
   5-minute unknown-state requery discipline? Who holds rail credentials?
4. **Retention windows**: counsel to set real windows for click context,
   conversion raw payloads, outbox rows, and consent records
   (`docs/counsel-briefing.md` §1); the 365-day defaults are sandbox
   placeholders.
5. **Secrets management**: where do `JWT_SECRET`, webhook secrets, DB/Redis
   credentials, and rail credentials live in production (vault/KMS)?
   Includes moving link `route_signature` off the reused JWT secret.
6. **Infra**: production Postgres (not pg-mem) soak + load test; Redis
   HA story for the click path; rate limiting / WAF in front of
   `/r/:token` and ingestion endpoints (the edge has none yet); log
   pipeline for the click-loss error signal in the fail-open path.
7. **Client-address hashing** (counsel): is `clicks.context.ip_hash`
   (HMAC-SHA256 with `IP_HASH_KEY`) personal data; who holds the key; may it
   ever rotate; how long may the hashes be kept (`RETENTION_CLICK_CONTEXT_DAYS`)?
   And may any log carry client addresses (today none does by default)?
8. **Amazon.in Associates** (owner / counsel, `docs/counsel-briefing.md` §9,
   `docs/action-tracker.md`): Amazon's written word on the `/r/` redirect;
   whether an unsigned, owner-downloaded report is an acceptable basis for
   ledger entries until Amazon offers something better (no reporting API was
   found); who may run `amazon.sh import`; where the Creators API secret
   lives once a secret manager exists.
9. **Celebrity looks** (counsel, `docs/counsel-briefing.md` §10): the
   capability matrix, the takedown timelines Afflino commits to, the
   retention of reply events and EXACT evidence, whether the keyed commenter
   hash is personal data.
