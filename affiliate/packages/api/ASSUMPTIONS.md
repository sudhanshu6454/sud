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
  409. Tested in `test/phase3.test.ts` ("a failing audit insert …").
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

