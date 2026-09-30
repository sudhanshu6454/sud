# @paparazzi/api — ASSUMPTIONS.md

Decisions, gaps, and contract concerns recorded while building the API.
Nothing here changes `packages/shared`, `db/`, or root configs (owned by
other agents) — flag anything that looks wrong to the owning agent.

## Blocking context (as of 2026-09-22)

- **`packages/shared/src/` was empty when this was written** — the shared
  contract had not landed. `src/shared-shim.d.ts` is a TEMPORARY ambient
  `declare module '@paparazzi/shared'` transcribed from the task's SHARED
  CONTRACT section so the package typechecks. TypeScript prefers the real
  resolved module once it exists; **delete the shim when it lands** and
  re-run typecheck. Divergences to reconcile then:
  - `ErrorCode` is typed as `string` in the shim; if the real contract uses
    a string enum/union, call sites pass literals today and may need casts.
  - `buildConversionEntries` input shape (`ConversionLedgerInput`) and the
    exact ledger accounts it posts were guessed from the schema/task text.
  - `checkBooksBalanced` is typed as `(entries) => boolean`; if the real one
    throws `LedgerImbalanceError` instead, simplify `assertBooksBalancedOrThrow`.
  - `buildEnvelope`/`hashPayload`/`EventEnvelope` field shapes were guessed.
- **`db/migrations/` was empty** — all SQL was written against the column
  lists in the task spec. Assumed (not verified): `outbox.payload`/`raw` and
  `clicks.context` are `jsonb`; `idempotency_keys.response` is `jsonb`;
  `outbox.published_at` nullable; `links.contract_version_id` nullable;
  `conversions.programme_id` NOT NULL (hence the 422 gap below);
  `ledger_entries` has a unique constraint on `idempotency_key`;
  `payout_batches.idempotency_key` unique; `conversions` unique
  nulls-not-distinct on `(provider_account_id, source_transaction_id, line_id)`.
- Runtime start (`tsx src/index.ts`) is blocked until `packages/shared`
  actually exists — the shim is types-only.

## Security / signing

- Link `route_signature` = HMAC-SHA256(**JWT_SECRET**, token). Dev-grade:
  reuses the JWT secret; **TODO: KMS-managed dedicated signing key** and
  signature verification on the redirect path (currently the redirect
  service trusts the token alone).
- `requireAuth` trusts JWT claims `{sub, org_id, role}` verbatim.
  **TODO: validate against `memberships`** (user_id/org_id/role) and add
  issuer/audience/expiry policy centrally.
- Role matrix is minimal and hard-coded (`requireRole`); **full RBAC is a TODO**.

## Attribution & finance gaps

- **Suspense programme resolution**: the provider event body carries no
  `programme_id`. Resolution order is (1) click chain
  clicks→links→offers→programme, (2) the single active programme for the
  connector in the org, else `422 CONVERSION_PROGRAMME_UNKNOWN`. If the real
  data model maps `provider_account_id` → programme elsewhere, replace (2).
- `provider_status` mapping (`approved`/`declined`/else `pending`) is inline;
  **TODO: delegate to connector `normaliseStatus`** when the connector
  interface lands.
- `postLedgerForConversion` returns `'skipped'` (logged, no throw) when
  `click_id` is NULL or no approved contract exists — **TODO: contract
  onboarding/backfill workflow** so attributable revenue isn't silently
  unposted.
- **Collected state is unimplemented**: `GET /v1/publisher/earnings`
  returns `collected: 0`; settlement/collection matching against merchant
  payouts is a TODO (brief §earnings lifecycle).
- Payout eligibility uses **MAX(`payout_threshold_minor`) across the
  publisher's approved contracts** (conservative); the brief doesn't specify
  how per-programme thresholds combine. Payable = net `publisher_liability`
  − amounts already in live batches; collected-vs-approved settlement is a
  TODO (see above), so "payable" currently derives from approved balances.
- Invented error codes (not in the brief): `CONVERSION_PROGRAMME_UNKNOWN`
  (422), `PAYOUT_BELOW_THRESHOLD` (422), `INVALID_BATCH_STATE` (409).
  `INTERNAL_ERROR` used for unexpected failures.
- `programme_capabilities` has no `org_id` column in the spec; it is scoped
  via `JOIN programmes … p.org_id = $1` in the link-creation query.

## Idempotency notes

- Replays return the ORIGINAL envelope verbatim, including the original
  `request_id` (documented, not a bug).
- A key seen under a different org is treated as new for replay purposes;
  the `ON CONFLICT (key) DO NOTHING` on store keeps the first writer's row.
- `POST /v1/payout-batches` second line of defense: row-level
  `idempotency_key` — on conflict the existing batch is returned with
  `200 {…, deduped: true}`.

## Phase 4 (2026-09-22) — CSV merchant connector

- **One money path, two ingestion shapes** (`src/conversion-ingest.ts`):
  the provider webhook (`POST /v1/integrations/:connector/events`) and the
  new file-based connector (`POST /v1/integrations/csv/uploads`,
  `src/routes/csv-uploads.ts`) both run `ingestConversionEvent`. Same
  idempotency key, same revision ordering, same suspense rule, same ledger
  posting, same outbox events. The worker-side mirror
  (`packages/workers/src/workers/provider-events.ts`) keeps its own copy —
  it reads the Redis queue, not the API, and was deliberately not touched.
- **`csv_text` transport**: the upload body carries the CSV as a plain
  string (no multipart). Sandbox-friendly and greppable; real merchants will
  want multipart or object-storage references — a hardening item, not a
  correctness gap in the ingestion path. 2 MB inline cap.
- **All-or-nothing validation**: every row is validated before anything is
  ingested. One bad row → `422 VALIDATION_ERROR` with per-row
  `errors: [{row, reason}]` and zero inserts (asserted in tests, including
  that a valid row in the same file is not ingested).
- **Programme supplied by the uploader**: unlike the webhook path (which
  resolves the programme from the click chain / single active programme for
  the connector), the CSV body names `programme_id`, which must exist in
  the org and be `active` (404 / 422 otherwise). Money is integer minor
  units — decimals are rejected, never rounded.
- **Error code stays `VALIDATION_ERROR`**: per-row detail rides in the
  top-level `errors` array because the shared `ErrorCode` union
  (`packages/shared`, owned by another agent) has no CSV-specific code —
  adding one there is their call.
- **Header-only/empty files** are rejected (422, "no data rows"); blank
  lines are skipped; column names are case-insensitive; extra columns are
  ignored; quoted fields follow RFC 4180.

## Phase 3 (2026-09-22) — pilot hardening

- **Kill switch** (`src/routes/programmes.ts`): `POST
  /v1/programmes/:id/pause|resume`, network_admin only, tenant-scoped (404
  for other orgs' programmes). Pause is idempotent; resume of a non-paused
  programme is 409. Both write `audit_log` and an outbox event
  (`programme.paused` / `programme.resumed`); the workers' outbox relay
  publishes these to the `events` Redis stream for corrections consumers
  (at-least-once, dedupe on `envelope.event_id`). **Atomic (2026-09-29):**
  the status change, the outbox event and the audit row are one transaction
  (`killSwitchTransition`); a failing audit or outbox insert rolls the status
  back and the call fails with nothing changed (before, a failing audit
  insert returned 500 after the pause had already taken effect). Resume's
  update is conditional on `status = 'paused'`, so a concurrent resume is
  409. Tested in `test/phase3.test.ts` ("a failing audit insert …", and
  "a resume that loses the race to a concurrent one is 409 and changes
  nothing": the conditional update matches no row → 409, no event, no
  audit row, no cache delete).
  The other audit/outbox writers (`disputes.ts`, `contracts.ts`,
  `publishers.ts`) still write their rows outside one transaction — open.
- **Redis dependency of the kill switch**: pause/resume delete
  `route:{token}` for every active link on the programme **after the
  transaction commits** (`deleteRouteKeys`; before commit a concurrent
  redirect could re-cache the old status). If Redis is absent or a delete fails, the
  redirect's DB fallback still serves the correct paused/active page — the
  failure mode is TTL-bound staleness (600s mint-warm / 300s rebuild), never
  wrong behaviour. The response reports `redis_available` so operators can
  see which mode applied. Test seam: `__setRedis` in `src/redis.ts`
  (mirrors `__setPool`); `undefined` = resolve from REDIS_URL as usual.
  **Second delete (2026-09-29):** a redirect whose DB read happened just
  before COMMIT (old status) writes its best-effort `set route:{token} … EX
  300` a moment later; landing after the delete, it would cache the old
  status for up to 300 s. So the same keys are deleted again
  `ROUTE_CACHE_SECOND_DELETE_MS` (2 s) after the first delete, on a timer
  off the request path (tested: "a redirect that re-caches the old status
  after the first delete is cleared by the second"). **Residual window,
  accepted:** a redirect whose read-to-SET gap exceeds 2 s (a stalled
  Redis or event loop), or an api restart in those 2 s, can still leave the
  old status cached until its 300 s TTL. A versioned cache entry (the
  redirect refusing a payload older than the programme's last change)
  would close it; not built.
- **Publisher onboarding** (`src/routes/publishers.ts`, 0003): forward-only
  state machine application → identity_review → property_verification →
  programme_eligibility → contract → active; skips are 409, same-state is
  200. `POST /v1/links` requires `onboarding_state = 'active'` → 403
  `PUBLISHER_NOT_ACTIVE` (new shared code). Pending accounts can draft
  looks/placements but cannot mint monetised links.
- **Unsupported merchant URLs** (`POST /v1/links`): the offer's destination
  hostname must be in the programme's `allowed_domains`, else 403
  `PROGRAMME_NOT_APPROVED` and no link is created. (The redirect service
  already 403s such destinations at click time; mint-time rejection fails
  earlier and never mints an unearnable link.)
- **Contract versioning** (`src/routes/contracts.ts`): new version =
  max+1, draft; `effective_from` must not precede the previous version's
  (409). Approval is a separate network_admin step. `postLedgerForConversion`
  and the link-mint contract pinning now only consider approved contracts
  whose `effective_from` is null or past — a future-dated version does not
  take effect early. Posted conversions keep their `contract_version_id`
  snapshot (reversals mirror the original split).
- **Disputes** (`src/routes/disputes.ts`, 0003): tickets may name no
  conversion (missing_commission). `POST …/resolve` requires
  `provider_verified: true` for outcome `resolved` (422 otherwise) —
  "screenshot alone never creates a payable sale" is code, not policy.
  Resolution never posts ledger entries; the provider must re-report via the
  webhook path. `disputes.publisher_id` is derived from the conversion's
  click chain when a conversion is named.
- **Consent**: the API and redirect neither set nor read cookies (asserted
  in tests: no `set-cookie` on `POST /v1/links` or `GET /r/{token}`). Raw IP
  is never stored (sha256 hash only, redirect side). DPDP consent UX for
  the PWA is a counsel-gated pilot item, not implemented here.

## Suspense queue operations (0004, `src/routes/suspense.ts`)

- **Policy as code**: retry binds `click_id` ONLY on an exact equality match
  `clicks.click_id = conversions.returned_click_ref`. There is no `LIKE`,
  no timestamp/IP correlation, no "likely publisher" heuristic anywhere in
  this path. A `NULL` `returned_click_ref` is a 422 — nothing deterministic
  to retry against — and no-match retries leave the row untouched (no audit
  row, no outbox event; "nothing found" is the expected outcome, not an
  event worth logging).
- **Review is bookkeeping, not money movement**: `POST …/review` touches
  only `reviewed_at`/`reviewed_by`/`review_note` + one `audit_log` row. It
  cannot change `click_id` and posts no ledger entries, by construction
  (the UPDATE lists only the three review columns).
- **Late attribution does not post ledger entries from the API.** A
  successful retry binds `click_id` and emits `suspense.attributed` on the
  outbox; a downstream consumer (workers/finance, owned by another agent)
  should run the normal validation/ledger-posting path off that event.
  This is deliberate: the money loop's posting logic and its contract
  checks live in the workers package, and duplicating them here would
  fork the payable-sale definition.
- **`reason_code` is derived, not invented**: `NO_CLICK_REF` when the row
  carries no reference, else `CLICK_REF_UNMATCHED`. There is deliberately
  no `NO_PROGRAMME_CONTRACT` code: programme/contract state does not
  determine click attribution, and the suspense queue is about unattributed
  clicks, not onboarding gaps (a separate finance concern).
- **No bulk retry endpoint**: retry is per-row and idempotent-guarded
  (`Idempotency-Key` supported). A bulk "retry everything" would re-scan
  `clicks` for the whole queue and invite operators to mass-bind on stale
  evidence; each row deserves its own human decision. Bulk ops need the
  user's explicit ask.
- **Retry is not a substitute for the webhook path.** The provider's
  amended report still arrives via the normal ingestion endpoint (dedupe +
  revision ordering apply); retry exists for the case where the click
  record arrived after the conversion event and the operator wants the
  binding now instead of waiting for re-report.
- **Roles**: `finance_operator`, `finance_approver`, `network_admin` —
  the same finance-facing set as the payouts routes (payouts.ts), not the
  dispute-route set (publisher-facing). Editors and publisher roles 403.

## Phase 5 (2026-09-22) — OpenAPI 3.1 spec (`docs/openapi.yaml`)

- **Grounded, not invented**: every path in the spec maps to a route
  registered in `src/routes/*.ts` (+ `/healthz` in `src/index.ts`). There is
  deliberately NO `GET /v1/links` — links are minted via `POST /v1/links`
  and resolved by the redirect service (`GET /r/{token}`, a different
  package). Roles, `Idempotency-Key` usage, status codes, and error codes
  were transcribed from the handlers' `requireRole`/`idempotencyCheck`/
  `AppError` call sites, and request/response shapes from the zod schemas
  and `ok(...)` payloads.
- **Reserved codes documented as reserved**: `RATE_LIMITED` and
  `UPSTREAM_UNAVAILABLE` are in the shared `ErrorCode` enum
  (`packages/shared`, owned by another agent) but no current handler raises
  them — the spec says so explicitly rather than implying they can occur.
  `TRANSFER_STATUS_UNKNOWN` is raised from the payout rail (`initiateTransfers`
  path), so it is documented on `POST /v1/payout-batches/:id/disburse`.
- **Auth scheme marked temporary**: the `bearerAuth` security scheme
  description states `requireAuth` is a stub to be replaced by a production
  IdP (membership validation, issuer/audience/expiry) — same TODO as
  `src/middleware.ts`.
- **Conformance test** (`test/openapi.test.ts`): parses the YAML with the
  `yaml` package (new devDependency of `@paparazzi/api`), pins an
  `EXPECTED_ROUTES` mirror to the real app via `app.hasRoute()`, asserts the
  spec documents exactly those path+method pairs (both directions), asserts
  the `ErrorCode` enum equals the shared contract's, and asserts the auth
  scheme is marked a temporary stub. `src/index.js` is imported dynamically
  inside the test because `db.ts` throws at import time when `DATABASE_URL`
  is unset and static imports hoist above the `process.env` assignments
  (same pattern as `phase3.test.ts`).
- **Dependency surgery note**: `pnpm add -D yaml` fails in this environment
  (`EPERM` chown on the lockfile temp file when pnpm runs as root here), so
  `packages/api/package.json` and `pnpm-lock.yaml` were edited by hand
  (`yaml@2.9.1`, integrity hash verified against the registry tarball) and
  `node_modules` was linked in pnpm's layout manually
  (`node_modules/.pnpm/yaml@2.9.1/node_modules/yaml` +
  `packages/api/node_modules/yaml` symlink). A future `pnpm install` on a
  machine where pnpm can write will converge to the same tree from the
  lockfile entries.
- **Pre-existing, not caused here**: the root lockfile importer (`.: {}`)
  does not cover the root `devDependencies` (`pg-mem`, `vitest`), so
  `pnpm install --frozen-lockfile` was already failing before this change.
  The `packages/api` importer (including the new `yaml` entry) matches
  `packages/api/package.json` — pnpm's own outdated-lockfile check reports
  only the root importer.

## Payout failure handling — status query before retry (2026-09-23)

- **No blind retry of ambiguous transfers.** The fake payout rail
  (`src/payout-rail.ts`, `initiateTransfers`) throws `TRANSFER_STATUS_UNKNOWN`
  (409) when a transfer in `'unknown'` state is re-initiated without a fresh
  provider status query (`last_status_query_at` older than 5 minutes). The
  disburse route documents the code and the demo's payout-failure scenario
  asserts the full loop: ambiguous callback → blind retry refused (409, no
  new transfer row, `provider_ref` unchanged) → status query arms the guard
  → re-initiate moves the SAME transfer `unknown → processing`.
- **`POST /v1/payout-transfers/{providerRef}/status-query`** is the status
  query: it calls the rail's `queryTransferStatus`, which stamps
  `last_status_query_at`, and returns the current provider-side status.
  Roles: `finance_operator`, `finance_approver`, `network_admin`. 404 for an
  unknown `provider_ref`.
- **Idempotency is what makes this safe, not retries being rare.**
  `payout_transfers.idempotency_key = 'transfer:<batch_id>:<publisher_id>'`
  collapses duplicate disburse calls to the same row, and the rail never
  re-initiates `paid`/`failed` transfers. So even after the guard is armed,
  a second disburse cannot create a second transfer row at the (real)
  provider — the no-double-payout guarantee holds by construction, not by
  convention.
- **Real-provider mapping**: swapping the stub for a real rail means
  reimplementing `queryTransferStatus` against the provider's status API and
  carrying the same 5-minute armed window (or the provider's own
  duplicate-protection semantics, documented here when known). The
  `TRANSFER_STATUS_UNKNOWN` 409 stays the response contract for an
  un-armed retry.

## Catalogue endpoints (consumer shop) — 2026-09-29

- **`GET /v1/looks` extended, not replaced.** Each item now also carries
  `source_page`, `sponsored`, `cover_url` (`assets.public_url` of
  `cover_asset_id`, else null — a private asset with no public copy renders
  as null, never as its storage key) and `item_count` (count of `look_items`
  rows). Pagination, `locale`/`category` filters and the `status='published'`
  gate are unchanged. `published_at` is now normalised to an ISO-8601 string
  in code (`new Date(x).toISOString()`) instead of relying on the driver's
  `::text` form, so pg and pg-mem produce the same JSON.
- **Pre-existing pagination bug fixed.** The original list query emitted
  `limit $${params.length - 1} offset $${params.length}` after pushing the two
  paging params, but `tenantQuery` prepends `org_id` as `$1`, so with no
  filters it ran `limit $1 offset $2` (limit = the org uuid, offset =
  page_size) and returned an empty page. No test covered the list before;
  `test/catalogue.test.ts` now pins page 1 / page 2 / filtered results.
- **`GET /v1/looks/:id` visibility is 404-only.** A look outside the caller's
  org, a non-`published` look for any role other than `editor` /
  `network_admin`, and a `placement_id` outside the org all return
  `404 NOT_FOUND` — never 403 — so a consumer cannot probe for drafts.
  Malformed ids are `400 VALIDATION_ERROR` (zod), as elsewhere.
- **Live offer = active + fresh + programme active.** A paused programme's
  offers are not shoppable even though the offer row itself is active; the
  same three predicates gate `POST /v1/links` (`OFFER_STALE` /
  `PROGRAMME_NOT_APPROVED`). Several live offers for a variant → lowest
  `price_minor`, ties by `id`. The endpoint reads only; it never mints.
- **`offer_url` is never selected.** No query in `routes/looks.ts` reads
  `offers.offer_url`; the consumer gets the tracked `link` (`{token, url}`)
  or `null`. The test asserts by `JSON.stringify` search that neither the
  key nor the merchant host appears in either endpoint's body.
- **Link read-back is the existing `links` row, not a mint.** With
  `placement_id`, the item's `link` is the `status='active'` row for
  `(placement_id, offer.id)`; if several exist (possible: `links` has no
  unique on that pair) the newest by `created_at` then `id` is returned.
  Paused links are not returned. `url` is composed by the new shared helper
  `src/redirect-url.ts` (`redirectLinkUrl`), which `POST /v1/links` now also
  uses, so the read-back is byte-identical to what was minted (trailing
  slash on `REDIRECT_BASE_URL` is stripped in one place).
- **Query shape is deliberately plain.** List: one grouped subquery join for
  `item_count` plus a left join on `assets`; detail: one look query, one
  placement query, one items query, then two small queries per item (live
  offer, link). No `LATERAL`, no `= any($n)` arrays, no timestamp `::text`
  casts on new columns — all within the pg-mem limits in `test/pgmem.ts`.
  Items per look are single-digit, so the per-item loop is not a hot path;
  revisit if a look ever carries dozens of items. Verified on pg-mem
  (`test/catalogue.test.ts`) and by a one-off smoke against a scratch
  Postgres 16 database with migrations 0001–0005 applied.
- **Spec:** `docs/openapi.yaml` gains `GET /v1/looks/{id}` and the
  `LookDetail` / `LookItem` / `LookItemProduct` / `LookItemVariant` /
  `LookItemOffer` schemas; `Look` lists the four new fields. The route is in
  `EXPECTED_ROUTES` (`test/openapi.test.ts`).

## Review fixes (2026-09-29)

- **Expired cover licences are withheld.** `cover_url` is returned only while the cover asset's
  `expires_at` is null or in the future (list and detail). Serving an image past its licence is
  a rights problem, not a display choice; `license` and `territory` are recorded but not
  enforced here, because what they permit is a counsel decision (docs/action-tracker.md).
- **`page` is bounded (≤ 1 000 000)** so an absurd value is a 400, not an out-of-range OFFSET 500.
- **`placement_id` on `GET /v1/looks/:id` is org-scoped, not publisher-scoped.** Any role in the
  org can read another placement's link tokens and ids. The in-house network's org (`afflino`,
  `db/seed-network.ts`) has one publisher, so this leaks nothing today; a multi-publisher org
  needs a publisher check here.
- **`scripts/mint-links.mjs` and stored replays.** The API stores every response below 500 under
  its idempotency key. mint-links retries once under a fresh key after a replayed 4xx (that key
  minted nothing, so no second link can result), and after a replayed 201 whose link the look
  detail no longer shows as active (paused since). Tested against a stub API
  (`packages/web/test/mint-links.test.ts`).

## Standalone app (2026-09-29)

- **Standalone since 2026-09-29** (history, not instructions). No API code,
  route or migration changed; the one-publisher org named in the review fixes above is now the
  in-house network that `db/seed-network.ts` seeds from a network file. Its parser has a unit test
  here (`test/seed-network.test.ts`) because this package owns the `yaml` dependency the seed borrows.

## Behind the edge (2026-09-29)

- **`TRUST_PROXY`** (`packages/shared/src/trust-proxy.ts`) is passed to Fastify's `trustProxy`:
  unset = trust nothing (as before). docker-compose.prod.yml sets `loopback,uniquelocal`: browser
  calls arrive from the web's `/api` proxy on the compose network, which forwards the
  X-Forwarded-For the edge (Caddy) wrote, and Caddy overwrites any client-supplied value
  (`docker/Caddyfile`). So `req.ip` is the visitor's address. Nothing in the API uses it yet
  (rate limiting would); tested in `test/trust-proxy.test.ts`.
- **The request log carries no client address**: the `req` serializer is `requestLogFields`
  (method, url, hostname), not Fastify's default with `remoteAddress` / `remotePort`. With
  `TRUST_PROXY` set the default would log every visitor's real address in the clear; whether
  any log may do so is a counsel item (`docs/threat-model.md` §6.7). `buildApp({ logStream })`
  is the test seam.
- **Production boot guard**: under `NODE_ENV=production` the API refuses to start without
  `REDIS_URL` (no route-cache warming, no kill-switch invalidation otherwise).
  docker-compose.prod.yml no longer refuses an empty `REDIS_URL` itself, because
  docker-compose.single-host.yml supplies it.
- The API is not public: the edge routes `/r/*` to the redirect and everything else to the web,
  so the API's public surface is `https://afflino.com/api/v1/...` through the web's proxy
  (provider webhooks and payout callbacks included). Port 3000 is published on 127.0.0.1 only.


## Amazon.in Associates (2026-09-29, 0006)

The owner's request: Amazon Associates for amazon.in on the in-house network. Built config-driven
with TEST values only; the policy brief of 2026-09-29 (Amazon's own pages: Operating Agreement
"OA", Participation "PR" and Linking Requirements "LR", help topics, Creators API docs) is the
source. Where the brief found nothing, the conservative behaviour is built and the question is
listed for the owner / counsel below.

**What exists**
- `amazon_associates_accounts` (one per org and marketplace; one per programme) and
  `amazon_tracking_ids` (tracking ID → exactly one placement, unique per account, append-only by
  convention). Code: `src/amazon/` (account reads, setup, offers, report format + import),
  `src/cli/amazon.ts` (`setup`, `offers`, `import-report`; ships as `dist/cli/amazon.js` in the
  api image), `routes/amazon-reports.ts`, `src/offer-price.ts`.
- **Links** (`routes/links.ts`): generally, the offer must belong to the named programme and the
  placement must be the named property's, in a campaign of that property's publisher (before,
  the four ids were never cross-checked). For an Amazon programme: the account must be active,
  the placement must be in a campaign of the programme (only properties the setup declared have
  one), the property must be on Facebook, Instagram or the owner's website (403
  `PROPERTY_FORBIDDEN`; Amazon's accepted networks do not include Snapchat, Telegram or
  WhatsApp; `AMAZON_ACCEPTED_PLATFORMS` in `@paparazzi/shared`), the placement's property needs
  a live `owner_operated` verification — always: there is no setting that allows third parties
  (403 `PROPERTY_NOT_OWNER_OPERATED`; PR 9 / OA §16: the tag only on "your site", never on a
  creator's) — and the offer URL must be exactly `https://www.amazon.in/dp/<ASIN>` — the
  stored URL never carries a tag.
- **Attribution** (`conversion-ingest.ts` `resolveAttribution`, also used by the suspense
  retry): a known click → the click path, but with a reported tracking ID the click's own tag
  must agree (else `ATTRIBUTION_CONFLICT`, suspense; the report import passes no click ref —
  no click id is ever put on an Amazon URL — so for Amazon rows this is the generic rule only);
  no known click → the ONE placement
  the tracking ID is mapped to, when the mapping began on or before the row's date (report rows
  are dated by day: `occurred_at` = the start of that IST day) and the placement's campaign is
  the programme's → `conversions.placement_id` (click_id stays NULL; a check forbids both).
  The ledger then walks placement → campaign → publisher with the conversion's programme, and
  the same latest-approved-contract lookup and snapshot as a click (`finance.ts`); earnings
  (pending), disputes and the eligible-earnings fallback learned the same path. The store ID
  (every unmapped placement's tag) is never an attribution basis
  (`TRACKING_ID_IS_STORE_DEFAULT`); an unknown one is `TRACKING_ID_UNMAPPED`; a mapping younger
  than the sale is `TRACKING_ID_MAPPED_AFTER_SALE`. The reason is stored in
  `conversions.suspense_reason`; suspense = `click_id IS NULL AND placement_id IS NULL`.
- **Mappings are prospective**: a mapping made today attributes rows dated tomorrow onwards; the
  CLI cannot backdate one. Historical rows (or the first day's) land in suspense, where a human
  decides. Deliberate: nothing proves which property earned a sale before the mapping existed.
- **Report import** (`src/amazon/report-format.ts`, `report-import.ts`): header-driven, the
  column aliases in ONE table (`EARNINGS_COLUMNS`), **layout to confirm with a real export**
  (Amazon documents the on-screen columns and "tab-separated" downloads, not the download's
  layout, order ids, date or decimal formats). Money: exact 2-decimal rupee strings → paise with
  BigInt (`@paparazzi/shared` `parseDecimalMinorUnits`); anything else (`12.5`, `12.505`,
  `₹12.00`, `1e3`) refuses the whole file. Dates: ISO or month names only; `09/10/2026`
  (day/month order undocumented) refuses the file. Keys: `provider_account_id` =
  `amazon-associates:<store id>`, `source_transaction_id` =
  `amzn-earn:<date>:<ASIN>:<sha256 of tracking ID, ASIN, date, seller, device, link type,
  price, sub-tag>` (first 32 hex), `line_id` `shipped`; revision 0, status approved (an
  Earnings row is a shipped item; the programme's returns window holds payouts). Commission =
  Amazon's Ad Fees as reported, never recomputed (fee schedule exclusions are Amazon's).
  Two rows with one identity in a file → 422. A row imported before with other amounts → 409,
  nothing written (the machine never rewrites an amount). Returns (negative fees) reverse the
  ONE approved sale of the same account, tracking ID, ASIN and currency, dated on or before the
  return, whose unreversed commission covers it; adjustment id =
  sha256-uuid('provider-return:' + account_ref + ':' + return key) so a re-import is a no-op;
  the insert is atomic (`insertReversalWithinRemainder`: the conversion row locked `for
  update`, the insert re-checks that the reversals stay within the commission); none or
  several candidates → `unmatched_returns` + outbox `conversion.return_unmatched`, nothing
  applied — the operator picks the ONE sale with the CLI's `returns` / `apply-return`
  (`src/amazon/returns.ts`; `amazon.sh returns`): the return's identity and amount come from
  that event, never typed in; the sale must be an approved conversion of the same account,
  tracking ID, ASIN and currency that covers the fee; the same deterministic id, so a re-run or
  a later import of the return does nothing; audit `amazon.return_applied`. (The generic
  kind=reversal is NOT the remedy: the webhook refuses Amazon rows, below.) A return with a
  zero fee is skipped.
  **One import at a time per account**: the whole import (pre-pass and writes) holds a
  session-level `pg_advisory_lock` keyed by org and account_ref (taken with
  `pg_try_advisory_lock` on a dedicated connection, retried for up to 30 s with the connection
  handed back between tries, else 409 with nothing written). A real-Postgres race of
  2026-09-29 (six concurrent return files reversed up to 5× a sale's commission; a pair of
  imports of one row with different amounts both landed in 9 of 10 pairs) is
  `scripts/amazon-import-race.ts` (`pnpm race:pg`, CI): 10/10 rounds exact after the fix. With
  the lock disabled on purpose, the atomic insert alone still kept the reversals exact, and
  the pair test failed 10/10 — each guard covers its own case.
  **Only this path writes Amazon rows**: `POST /v1/integrations/csv/uploads` with the Amazon
  programme or an Amazon account_ref, and `POST /v1/integrations/:connector/events` with an
  Amazon account_ref (conversion or reversal), a reversal of an Amazon conversion, or a click
  ref that resolves to the Amazon programme → 422 (`isAmazonReportPath`); the shared ingest
  also refuses a non-Amazon connector on them (`CONVERSION_PROGRAMME_CONNECTOR_MISMATCH`).
  Before, an editor could decline an imported sale (auto-reversal) or claim future
  `amzn-earn:*` keys through the CSV connector.
  XML downloads are refused with a message (not built). The Orders report (unshipped items) is
  not imported: pending Amazon orders are not money yet.
- **Prices** (`src/offer-price.ts`): `programme_capabilities.price_max_age_hours` (1 for
  Amazon: the Creators API's cache table, "Offers | 1 hour", is stricter than OA §11's "up to
  24 hours"; the conflict is counsel's, `docs/counsel-briefing.md` §9) → only a price with
  `price_as_of` inside the limit is returned; otherwise
  `price_minor` is null (GET /v1/looks/:id, GET /v1/offers). Amazon offers are created with no
  price; only the workers' Creators API refresh sets one. No images, titles or reviews are
  stored (the product copy is the operator's own words).
- **Setup CLI** refusals (nothing written): a changed store ID, a remapped tracking ID, a second
  tracking ID for a placement, the store ID as a mapping, a property that is not approved or not
  owner-operated, a property on a platform other than Facebook / Instagram / web, a tracking ID
  that is not `<letters/digits/hyphens>-21` or contains a proprietary term (amazon, kindle and
  misspellings; alexa, echo, prime, prime video, audible, fire tv, firestick, imdb, zappos,
  whole foods — OA §7's list of Amazon's marks is non-exhaustive, the owner checks the rest;
  PR 12), a `--disclosure` without OA §10's statement word for word, a first contract without
  `--publisher-share-bps`, and TEST values (`demo…`, `B0DEMO…`) under `NODE_ENV=production`.
  The properties file is required and is the whole declaration (the `--all-owner-operated`
  shortcut was removed: it declared pages regardless of the Associates website list); the
  removed flags (`--all-owner-operated`, `--third-party-publishers-allowed`,
  `--subtag-approval-ref`, `--subtag-param`) are refused with their reason.
  Status of the programme and the account are set on insert only. The setup's one cross-org
  read: a store ID already registered by another organisation is refused (operator CLI only). After COMMIT the cached
  routes of links whose tag may have changed are deleted (now and 2 s later, the kill switch's
  `deleteRouteKeys`); without Redis they expire within 600 s and a sale in that window carries
  the old tag → suspense, never the wrong placement.
- **Sub-tags: never a click id.** LR — "Upon your request but subject to our approval, we may
  issue you additional “sub-tag” Associate IDs … Under no circumstances may you associate any
  sub-tag with a specific end user of your site (e.g., you may not dynamically assign sub-tags
  to users as they arrive on your site …)". A per-click id is exactly that, so approval cannot
  make it allowed: `amazonRouteParams` always sets `subid_field: null`, the redirect strips
  `ascsubtag` and `subid`, and 0006 has no sub-tag columns (the setting, its approval
  reference and its CLI flags were removed on review, 2026-09-29). Should Amazon ever issue
  fixed sub-tag IDs, they would be one fixed value per placement (on `amazon_tracking_ids`,
  applied through `set_params`) — not built. A report's sub-tag column is kept as evidence
  (`conversions.raw`) only. `ascsubtag` itself is not documented on any amazon.in page.
- **Offers Amazon reported not accessible** stay stale when re-listed (`offers.stale_reason`
  `merchant_not_accessible`, written by the workers' refresh): `offers` counts them in
  `kept_not_accessible` and changes nothing unless `--reactivate`; the refresh reactivates one
  when Amazon returns the item again.

**Added for the shop and the owner's server steps (2026-09-29, stage 2)**
- **Catalogue**: the look item's offer carries `connector` (the programme's;
  the shop's Amazon copy keys on `amazon-associates`) and, for a programme
  with a price age limit, `stock_status` `unknown` whenever the price is not
  shown (`displayableStock`, `src/offer-price.ts`; LR: "prices and
  availability"); `GET /v1/offers` applies the same rule.
- **Offers file, `look` column** (`src/amazon/offers.ts`): rows naming a look
  go into one published look per title (placeholder cover: an `owned` asset
  with no public URL; no category, no source page, not sponsored; status on
  insert only; items only ever added). The shop shows products only inside
  looks, so this is how an Amazon product reaches `/shop`. A look is found by
  title in the org, so an existing look of that title gets the items.
- **CLI `template` / `links` / `status` / `pause` / `resume`**
  (`src/amazon/links.ts`, `src/cli/amazon.ts`). `links` mints through
  `POST /v1/links` itself (Fastify `inject` in the CLI process, a 30-minute
  `network_admin` token signed with `JWT_SECRET` that never leaves the
  process), one link per (declared placement **with its own tracking ID**) ×
  (live Amazon offer); placements that carry the store ID are skipped
  (their sales could never be attributed — the store ID is never an
  attribution basis) and listed. Existing active links are reused (read
  from the DB, org-scoped); a stale idempotency replay under the fixed key
  `amazon-links:<placement>:<offer>` is retried once under a fresh key.
  `pause` / `resume` call the kill-switch routes the same way, as the org's
  first `network_admin` member (the audit row's actor must be a users row).
  `status` counts with the suspense predicate and reason codes of
  `routes/suspense.ts`.
- **The choice of pages** (`docs/runbooks/deploy.md` §1A): one tracking ID
  per page and links only for pages with one, i.e. afflino.com + up to 99
  pages under Amazon's 100-ID limit. Grouping pages under a shared ID was
  rejected: Amazon's report names only the tracking ID, and a shared ID
  cannot name one placement (suspense).
- **The owner's steps** are `deploy/linode/amazon.sh` (keys → the update
  line → template → the two files → setup (which also turns on the footer's
  Associate statement) → offers → links → shop → import → returns → check;
  pause / resume), rehearsed on the installer's stack with TEST values (the
  prompts fed from standard input; `deploy/linode/README.md`). `links` and
  `shop` refuse while `/privacy` is the stub page (OA §5's privacy
  disclosure) or the footer statement is off.
- **The link sheet** carries `post_label` (`#ad · Buy on Amazon.in`,
  `AMAZON_POST_LABEL`, a draft pending counsel): every post starts from the
  link-level disclosure.

**Open (owner / counsel), nothing concluded here**
- Whether an afflino.com/r/<token> redirect (a "Redirecting Link", OA §7; PR 30 bars cloaking
  the originating site) on the declared FB/IG pages is acceptable — ask Associates support in
  writing. The redirect is a plain 302, never an interstitial, sends no `no-referrer`
  (Caddy: `strict-origin-when-cross-origin`) and is `noindex`.
- Whether the `/dp/<ASIN>?tag=` form (the Creators API's vended links are not used: they are
  generated for one partner tag and "Alterations of any kind to vended links" lose attribution)
  is what Amazon expects; the only amazon.in example is `/gp/product/<ASIN>/?tag=`. Its
  consequence: the API allowance after the first 30 days follows "shipped item revenue
  generated via the use of Creators API", i.e. its own links, so prices will likely stop then
  (`docs/capacity-plan.md`; the workers back off on 429 / 401 / 403).
- The 100-tracking-ID limit vs 404 properties: grouping loses per-page attribution (a shared
  tracking ID cannot name one placement here, so grouped pages would earn into suspense).
- A multi-merchant afflino.com vs the API's "principal purpose of advertising the Amazon Site";
  no prices / Amazon images in social posts; ASCI disclosure wording; GST / TDS on Amazon's fees;
  automated report download vs the Conditions of Use (import is manual).

**What the owner must supply before real use** (none of it is in this repository)
1. The amazon.in Store ID (`…-21`) of an account past final acceptance (3 qualifying sales in
   180 days), with afflino.com and every FB/IG page that will carry links on its website list,
   all owned or controlled by the account holder.
2. The tracking IDs created in Associates Central (at most 100; none containing an Amazon mark:
   "amazon", "kindle", "alexa", "echo", "prime", … — Amazon's list is non-exhaustive), each paired
   with the ONE Facebook / Instagram / web property it belongs to, as the properties file
   (`platform,account,tracking_id`; the platform / account of the network file; `amazon.sh
   template` writes a starting file). Pages without one carry the store ID, get no links from
   `amazon.sh links`, and any sale under the store ID lands in suspense.
3. The in-house contract split (`--publisher-share-bps`) and, if not the defaults (60 / 30
   days), the validation delay and returns window.
4. The disclosure line in every page's bio / About ("As an Amazon Associate I earn from
   qualifying purchases.", OA §10) — outside this system.
5. The ASINs to feature, each with the owner's own brand / model / category words, and the
   shop look each belongs to (the offers file's `look` column).
6. A real earnings download (TSV, and XML if that is what is used), including a return row, so
   `EARNINGS_COLUMNS` and the date / decimal handling can be confirmed.
7. Creators API credentials (id, secret, version 3.2) once Amazon grants them (10 sales in 30
   days), entered at a hidden prompt only; until then no prices are shown.
8. Counsel's privacy notice on /privacy (OA §5: third parties, Amazon included, may place or
   recognise cookies) — `amazon.sh links` and `shop` refuse until it replaces the stub.
9. Amazon's written word on the /r/ redirect; counsel on the items listed above; the
   accountant on GST / TDS; whether Amazon's payments are recorded as merchant settlements
   (nothing writes `merchant_settlements` in production yet, so payouts stay capped at 0).

## Celebrity looks (0007, 2026-09-30)

The owner's direction: celebrity looks from the paparazzi library, the outfit
tagged piece by piece (EXACT = the product the celebrity wore; SIMILAR = a
similar style, the default), storefronts per in-house page, comment replies,
instant links, analytics — under the rights brief of 2026-09-30 (controls, not
legal conclusions; the questions are `docs/counsel-briefing.md` §10).

**Model** (`db/migrations/0007_celebrity_looks.sql`, extending looks and look_items; no parallel model)
- `celebrities`: `rights_status` unreviewed (default) | editorial | cleared | blocked;
  `max_display` / `shoppable` = what the review allowed for this person; `is_minor`,
  `never_list` (both force unreviewed / blocked, a CHECK); `takedown_id`. Every decision is a
  row of `celebrity_rights_reviews` (append-only) + an audit row.
- The capability matrix is ONE constant (`CELEBRITY_RIGHTS_MATRIX`, @paparazzi/shared
  celebrity.ts): unreviewed / blocked nothing; editorial name only, no products; cleared name,
  image and products at most. **Defaults pending counsel.** The review route defaults
  max_display to `name_only` and shoppable to false: an image or products need the reviewer
  to say so. The database stores only the per-person decision and enforces the floor.
- `looks` gained the moment (`celebrity_id`, `event_name`, coarse `place` + `place_kind`,
  `moment_date`, `source_video_asset_id`, `still_asset_id`, `property_id` = the in-house page,
  `post_permalink`, `platform_post_id`, `library_ref`), `celebrity_display` (the operator's
  mode, capped by the rights at every read) and `takedown_id`.
- `look_pieces` (label in the owner's words, `garment_category` = GARMENT_CATEGORIES, tested
  equal to the CHECK; position; optional hotspot x, y in 0..1). `look_items.piece_id`,
  `position`, `review_state`, evidence source / time, `tagged_by`, `match_reviewed_by/at`,
  `removed_at`; CHECKs scoped to piece items (legacy and Amazon shelf items untouched): a
  SIMILAR item is approved; an EXACT item has evidence (≥ 10 characters + a source) and, once
  approved, a reviewer other than its tagger. Partial unique indexes: one EXACT per piece, a
  product once per piece (rows not removed). The API pre-checks both (409).
- Assets: licence metadata (`commercial_reuse`, `territory`, `expires_at`, `source_ref`,
  `copyright_owner`, `author`, `acquisition`, `assignment_ref`), exclusion flags
  (`live_performance`, `minor_in_frame`, `bystanders`, `sensitive_location`) and the editor's
  `screen_status`. An image is shown only when `assetImageRefusals` is empty (public copy,
  still/cover, licence, commercial reuse `yes`, territory covering IN (or WW), not expired,
  screen passed, no flag) AND the celebrity's rights and the look's mode allow images.
- `storefronts`, `takedowns` (+ `takedown_looks` snapshot), `meta_accounts`, `reply_rules`,
  `reply_events`, `reply_suppressions`, `reply_daily`, `click_daily`; `links.look_item_id`,
  `paused_by_takedown_id`, `paused_reason`.

**Reads: never more than the rights allow at this moment**
- One read gate, in SQL for every list (`readGateSql`, src/looks/public.ts) and in JS for one
  look (`publicVisibility` / `publicLook`, src/looks/bundle.ts): published, no takedown on the
  look or the celebrity, not a minor / never-listed, a status whose capability allows the name
  and a review that allows at least the name. Then per look `effectiveLookDisplay`: the name,
  the image (asset rules), products and links only when shoppable; a pending EXACT never.
  A downgrade, an expiry or a takedown applies at the next read without re-publishing.
- The legacy catalogue (`GET /v1/looks`, `GET /v1/looks/:id`) never serves a celebrity look
  to a consumer role (the current shop keeps its non-celebrity looks; editors still see
  everything by id).
- The public API (`/v1/public/:org/…`, routes/public.ts) takes no token: the organisation is
  its public slug, resolved by `orgBySlug` — the one public query not tenant-scoped (the slug
  is the tenant's public name; the same kind of documented exception as the redirect's lookup
  by token). Everything after it is `tenantQuery`. Answers carry `cache-control: public,
  max-age=30`; since the reviews the api also keeps each answer 30 s per process under a Redis
  epoch every invalidation increments (below). 410 GONE only for content a takedown withdrew
  that was public once; 404 for anything never public or hidden by a downgrade.
- Headlines are composed from the event or place the editors typed, never the name
  (`lookHeadline`: "Spotted at {event}", "Spotted in {place}", "Spotted"; since the reviews);
  the look's `title` column never reaches a page. The wording (`CELEBRITY_COPY`: commercial
  label, non-endorsement line, "The same item", "Similar style. {name} did not wear or endorse
  this product.") is a draft pending counsel.

**Publishing** (`publishGate`, src/looks/gate.ts; 409 with the whole report): celebrity set;
no takedown; not a minor / never-list; the rights allow the look's mode; a shown still passes
the asset rules; a moment date before today (IST: never live whereabouts); an approved,
owner-operated Facebook / Instagram page; no endorsement / Amazon / sensitive-place wording in
event, place or piece labels, and no celebrity's name in them (`no_names_in_text`); a `street`
/ `other` place confirmed by the rights reviewer (`place_kind`); product text without names or
endorsement wording (`product_text`); ≥ 1 piece, each with ≥ 1 approved product; no pending EXACT; when
shoppable, a live offer per piece and the mint guards passing for every product's link
(`checkMintGuards` dry run: the Amazon rules of POST /v1/links).

**Links** (src/links/mint.ts, src/looks/look-links.ts)
- POST /v1/links' guards were moved, unchanged, into `checkMintGuards` / `insertLink` /
  `warmRouteCache`; the route is a thin wrapper (its tests unchanged).
- A look's own link per approved product goes on afflino.com's web placement in the offer's
  programme's campaign (for Amazon only a placement with its own tracking ID), since the
  reviews: a link shown on afflino.com carries afflino.com's tag, never the posting page's
  (`chooseLookPlacement`; before, the look's own in-house page's placement came first). The
  in-house pages' own links for their posts are the instant links' (below).
- Minting takes the look's row lock (`select … for update`) and re-checks published / not
  taken down; a takedown updates that row first. On real Postgres 10 rounds of the race never
  left an active link on a withdrawn look (scripts/celebrity-looks-pg.ts R2). Look-scoped
  links do not warm the route cache (the redirect rebuilds from the committed state).
- Pauses record their reason (`takedown`, `rights_review`, `item_removed`,
  `look_unpublished`); publishing again or an upgrade reactivates only `look_unpublished` /
  `rights_review` pauses; a restore only its own takedown's.
- Instant links (src/looks/instant-links.ts) reuse `addAmazonOffers` (the operator's words;
  its new `orgId` option); product text with endorsement wording is refused for any use;
  links for a piece are withheld while the celebrity may not have a shoppable page.

**Takedowns** (src/looks/takedown.ts): one transaction (looks locked, snapshot, withdrawn,
celebrity flagged, links paused, reply rules off, queued replies cancelled, outbox, audit);
after commit the route keys are deleted twice and the web revalidated (`WEB_REVALIDATE_URL` +
`WEB_REVALIDATE_SECRET`, best-effort, 3 s timeout; unset = skipped); `completed_at` + a
`takedown.completed` audit row. The answer lists the in-house posts the owner deletes on Meta
(no API permission to delete posts is held). SLA marks: warn > 60 min, breach > 180 min
between `requested_at` and `actioned_at` (alarms are not wired: open). Restore: rights
reviewer only, and only with a `review` row of every affected celebrity newer than the
takedown; published looks come back only if the gate passes (else paused).

**Comment replies, api side** (src/looks/replies.ts, routes/meta-webhook.ts)
- The webhook route lives in its own plugin whose content-type parser keeps the raw bytes; the
  signature is checked over them (`timingSafeEqual`). Meta signs the escaped-unicode payload,
  so re-serialised JSON would not match (tested). Missing `META_APP_SECRET` or
  `COMMENT_ID_HASH_KEY` → 503.
- The account is resolved through `meta_accounts` by (platform, Meta id) — the webhook's one
  cross-organisation read (a Meta id is unique to one property). Own comments (from the
  account or its Page) are dropped; `on conflict (platform, comment_id) do nothing` makes
  retries and duplicate deliveries one event (10 concurrent deliveries → 1 on real Postgres).
- Opt-out: a comment or a message that is exactly an opt-out word adds the author's hash.
  CAVEAT: on Facebook the id in a comment and the PSID in a message may differ, so a "STOP"
  message may not match a later comment of the same person (open; counsel/Meta).
- The answer body carries counts only (Meta ignores it).

**Library import** (src/looks/library-import.ts): whole-file refusal (parse checks, then a
read-only pre-pass of what only the database can tell: pages, ambiguous aliases, a look whose
celebrity would change), then one transaction under a per-organisation advisory lock. Key:
`library_ref` = video_ref (+ `#moment_ref`). Drafts only; descriptive fields and pieces change
only while a look is a draft; a changed `still_url` sends the still back to the frame screen;
a minor flag is applied, never removed. Under `NODE_ENV=production` "Demo …" names and
example.com / .invalid / .test URLs are refused.

**CLI** (src/cli/looks.ts): `review` / `restore` act as the organisation's rights reviewer —
its first `rights_reviewer` member, else a placeholder `rights_reviewer@<org>.invalid`
created the first time. That is the owner recording counsel's written decision on the server
(root); the API's role separation is unchanged. `takedown` acts as the first network_admin.

**pg-mem** (test/pgmem.ts, scripts/demo-money-loop.ts): `char_length` registered; the
memberships role CHECK renamed; pg-mem answers any query sharing a predicate with a partial
index's WHERE from that index alone (verified), so the two `is not null` partial indexes become
plain unique ones and the two look_items partial indexes are not created there (proven on real
Postgres, R1).

**Stage 2 (2026-09-30): what the web needs** (`test/celebrity-web-support.test.ts`):
- `GET /v1/public/{org}/spotted` also answers `facets` (celebrities with a public look and
  live storefronts, each with its count, through the read gate) and `commercial_label`.
- `GET /v1/public/{org}/trending?days=1..30&limit=1..12` (default 7 days, 12): `click_daily`
  of the organisation in the window joined to `links` and `look_items` to find each click's
  look, summed and ranked in JS (ties by the newer publish), then the top ids re-read as cards
  through `readGateSql` (`l.id = any($2)`), so a takedown or a downgrade drops a look at once.
  No count leaves the API. Empty until the rollup has run.
- `GET /v1/editorial/properties`: the organisation's Facebook / Instagram / web properties with
  `owner_operated`, the Amazon tracking ID and the storefront (the admin's page pickers).
- `POST /v1/editorial/library/import {csv_text ≤ 900000, dry_run = true}`: `checkLibrary` runs
  the import's own checks (`libraryPrecheck`, shared with `importLibrary`) without writing and
  answers `ok`, the problems, the rows, looks new / existing, pieces and celebrities (200);
  `dry_run: false` imports (actor = the caller), and a refused file is 422
  `VALIDATION_ERROR` with `problems`, nothing written. The organisation's slug is read from
  the tenant's own row.
- `GET /v1/replies/events?rule_id&status&limit≤200`: the latest events with the page, the
  keyword, the status and the times; never the comment id, the commenter hash, the media id
  or the message id. Every reply rule in the list / create / update answers carries
  `look_url`, `dm_preview` (`buildReplyText`), `dm_bytes` and `dm_refusal` (the send-time
  check), so the admin shows the exact message.
- CLI: `storefronts` answers each storefront with `bio_url` (`SITE_URL/s/<slug>`) and takes
  `--publish yes` (every draft made live, counted as `published`); `events [--limit]`;
  `reply-test --look <uuid> [--webhook <base>]` (the message and its refusal check, a stub
  sender, the matching rules; with `--webhook` the verify handshake, a wrong verify token 403,
  a signed delivery for the TEST account `990000000000000001` that no page is mapped to 200
  with nothing stored, a wrongly signed one 401); `sign-in --role network_admin | editor |
  rights_reviewer [--hours 1..24]` (the JWT stub signed with `JWT_SECRET`: the first
  network_admin, the first `editor` member or a placeholder `editor@<org>.invalid` "Second
  editor", the rights reviewer as above). The second editor exists so the EXACT maker-checker
  (`match_reviewed_by <> tagged_by`) can be met with the owner's own steps; the stub cannot tell
  who holds a token, so the owner hands each sign-in to its person.

**After three independent reviews (2026-09-30)** (`test/celebrity-controls.test.ts`, 30 tests,
one per finding the reviews probed; `scripts/celebrity-looks-pg.ts` on real Postgres):
- Names (`src/looks/names.ts`, @paparazzi/shared `namedCelebrities`): every celebrity's name
  and aliases, matched as words (also glued, hyphenated, a handle of 8+ characters, numbers 0–20
  spelled out). A name appears only in the credit line of that person's own look: the look's
  event, place and piece labels, product brand / model / category, a storefront's slug, name
  and bio, an Amazon shelf's title and a public comment reply are refused when they name
  anyone (422) and hidden at every read (a look 404s, a product is left out, a storefront
  404s, a card loses its storefront link, facets and the sitemap drop it). One query per
  public answer (the organisation's celebrities), kept by the answer cache.
- Product text (`productTextRefusals`): the endorsement list widened ("inspired", "inspo",
  "replica", "first copy", "7A", "lookalike", "as seen", "spotted wearing", "steal / get the
  look", "budget version", "<word> style", "<someone>'s <belonging>", "rocked", "the star",
  "bollywood"), applied to every product row of `amazon.sh offers`, instant links, tagging
  and editing, and the SIMILAR downgrade. `word_style`, `possessive` and `rocked` apply to
  product text only (not to a look's event or place). A shelf title may not reuse a
  celebrity look's title; the lookup for a shelf ignores celebrity looks.
- Chain of title: `copyright_owner`, `acquisition` and, for anything but `staff`, an
  `assignment_ref` (`chainOfTitleRefusals`, part of `assetImageRefusals`); the library refuses
  `commercial_reuse=yes` without them.
- Places: `street` / `other` need `looks.place_confirmed_by/at` (`POST
  /v1/editorial/looks/:id/confirm-place`, rights reviewer only, an optional note); a change
  of event, place or kind clears it; the sensitive-place list widened (medical words,
  residences incl. building / tower / society / villa / colony, classes, coaching, worship).
- Assets (`updateAsset`): the frame flags are one-way (clearing one is 403); widening a
  licence fact (commercial reuse, territory covering India, a later or no expiry, the chain of
  title) needs the rights reviewer (403 for an editor) and writes `asset.widen:<fields>`; a
  new `public_url` resets the frame screen unless the same call passes it; every change
  invalidates.
- The still at its own address (`GET /v1/public/:org/looks/:id/still`, `src/looks/still.ts`):
  the page's image is `/img/looks/<id>?v=<10 hex of the origin URL's sha256>`; the origin URL
  never leaves the api; bounds in `still.ts` (https only and no private host in production,
  no redirect, 8 s, 12 MB, image types). Kept 30 s under the epoch within 64 MB, keyed by the
  look (a made-up `v` cannot force a fetch); an origin failure (502) is never kept.
- Guards (`src/public-guard.ts`): `PUBLIC_RATE_PER_MINUTE` (240) on `/v1/public/*` and
  `WEBHOOK_RATE_PER_MINUTE` (1200) on the two Meta POSTs, per client (an HMAC of `req.ip`, in
  memory), 429 `RATE_LIMITED` with Retry-After; the web's own server-side calls (no
  X-Forwarded-For, a loopback / private TCP peer) are not counted — every visitor reaches the
  api through the edge, which always sets X-Forwarded-For, so counting the web's own calls
  would put every visitor in one bucket. The answer cache: 30 s per URL under `public:epoch`
  (Redis, incremented by `invalidateAfterCommit`), 1000 entries; off without Redis or with
  `PUBLIC_API_CACHE=off`; `x-public-cache: hit | miss`.
- Links: `mintItemLink` mints only for an approved item (409 for a pending EXACT) and while
  the celebrity's rights allow a shoppable page (409), under the look's row lock; instant
  links require a piece (422), reuse the item for the same (piece, product) and withhold the
  links of a pending EXACT (run again after the approval). A review turning products off, an
  alias change and the library's minor flag pause the links inside their own transaction
  (`lockAndPauseCelebrityLinks`; real Postgres R5: 10 rounds of a mint racing such a review,
  never an active link left).
- Aliases: adding a name (by normalised key) sends a reviewed celebrity back to unreviewed
  (a `rename` review row), like a rename.
- Takedowns: a celebrity's takedown also withdraws the other looks whose text names that
  person (`looks_named_in_text`) and pauses the plain page links of the affected looks'
  products (`other_links_paused`); the answer lists `stills` (asset id, library reference)
  and `share_urls` (the look and hub addresses for Meta's Sharing Debugger); content never
  public stays 404. Restore: a new review is required of the target celebrity only; links
  come back only for looks that are published and allowed products (the rest `rights_review`).
- 410 only for what was public: `publicVisibility` answers `gone` only for a look with
  `published_at`; a hub only if one of its looks was published.
- Comment replies: the public answer is one of `PUBLIC_REPLY_TEMPLATES`; a rule can be
  enabled only for a look that may send (`lookSendable`: public, shoppable, an approved item
  with a live offer), and the workers re-check it before each send; `reply-test` also sends
  a signed messaging STOP (a TEST suppression written, then removed). Meta's data deletion
  callback `POST /v1/integrations/meta/data-deletion` (`parseSignedRequest`,
  `deleteMetaUserData`: the org of each Meta account resolved first, the deletes
  tenant-scoped; the opt-out hash kept).
- The request log records the path without its query string (Meta's verify token travels
  in the GET's query). The web revalidation goes in batches of 1000 tags. Analytics sums in
  SQL (`group by`) and is open to network admins and editors only (a publisher owner's token
  would have seen every page's clicks).

### The owned default (2026-09-30)

The owner: "all clips are owned by us"; "all footages captured in public place of any celebrity
they dont own the rights we own it". Built as the owner's recorded statement, not as a silent
default (`src/looks/ownership.ts`, `looks.sh owned`, `test/library-import.test.ts` "the owned
default"):

- The statement is recorded on the server only (the CLI, as the organisation's first network
  admin; no API route), with the legal owner's name and who shot the clips (`staff`: own
  employees only; `other`: employees and freelancers or agencies working for it), the words the
  owner confirmed at the prompt, the date and an audit row. Append-only; a new statement
  supersedes the old; a withdrawal is a row of its own.
- A library row that leaves all seven licence columns blank (or a file without them) takes the
  statement in force: `commercial_reuse` yes, `territory` WW, no end, the statement's copyright
  owner and acquisition, `assignment_ref` `owner-statement:<id> <date>` (so `other` still has a
  reference), `licence_via` `statement`. No statement in force: such a row refuses the file,
  as before. A row that fills any licence column is its own licence and needs `licence`,
  `commercial_reuse`, `territory` and `licence_expires` (the per-row override).
- The widening rule of the API (only the rights reviewer widens) now holds against files too:
  an asset whose licence a person edited (`licence_via` `review`, set by `updateAsset`) takes
  a file's narrowing but never its widening (`mergeOverReviewed`, field by field with
  `assetWidenings`); the import lists what it kept (`licence_kept`). Before this, a re-import
  silently reverted a person's narrowing.
- Recording or withdrawing takes the import's advisory lock, and the import reads the
  statement after taking it: no import writes a statement's licence after its withdrawal.
  Withdrawing narrows every `statement` asset to `commercial_reuse` unknown in the same
  transaction and clears the look, hub and storefront caches after it.
- What it does not do: it says nothing about the celebrity's own rights. Nothing about a
  celebrity is published without their review, whatever the licence (the gate is unchanged).
  The statement's truth is the owner's; the build records it and checks that it exists, as it
  does for every other chain-of-title reference (counsel-briefing §4, §10 Q30).

**Open (engineering)**: no rate limit at the edge or on `/r/`; the api's limit is per process;
the name and endorsement checks are English word lists and do not read text inside images;
nothing alerts on Meta's `messaging_policy_enforcement` deliveries; the JWT stub trusts the
`rights_reviewer` and `editor` claims like any other (a leaked `JWT_SECRET` could forge them),
and a sign-in cannot be revoked before it expires.
