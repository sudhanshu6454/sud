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
8. **No rate limiting** on `/r/:token`, webhook, or CSV endpoints; Redis
   outage degrades the click path to DB-per-click.
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
