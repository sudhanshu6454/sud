# ASSUMPTIONS.md — @paparazzi/workers

Contract concerns are recorded here rather than worked around by editing
`packages/shared`, `packages/api`, `db/`, or root configs (owned by sibling agents).

## Shared contract — resolved against the real module

`packages/shared/src/` landed while this package was being written; the code was
reconciled against the actual exports. Remaining deviations from the original
build spec are listed here.

1. **`buildEnvelope` takes a params object**: `buildEnvelope({ source,
   source_account_id?, event_type, payload, occurred_at? })` — not
   `buildEnvelope(eventType, payload)`. The worker passes `source: 'workers'`.
2. **`EventEnvelope` carries no `org_id`** (fields: `schema_version`, `event_id`,
   `source`, `source_account_id`, `occurred_at`, `received_at`, `event_type`,
   `payload_hash`, `payload: unknown`). Tenant scope therefore travels in **job
   data**: `ProviderEventsJobData = { envelope, org_id, programme_id? }`. The
   API producer must set both; every SQL query still includes `org_id`.
3. **`RawConversion` carries no `programme_id`** (fields:
   `provider_account_id`, `source_transaction_id`, `line_id`, `returned_click_ref`,
   `currency`, `eligible_value_minor`, `commission_minor`, `provider_status`,
   `provider_revision?: number`, `occurred_at`, `received_at`, `raw: unknown`).
   The build spec's "payload may carry programme_id" was adapted: the programme
   comes from job data (the API knows the integration route). If absent, the
   worker logs and skips — TODO: resolve via the `programmes` table by
   `(connector, provider_account_id)` once the connector registry exists. Never
   guessed from the payload.
4. **`assertMinorUnits(n: number)`** takes a `number`, not `unknown` — callers
   narrow with `typeof` first (see `requiredMinorUnits`). It rejects negatives.
5. **Two `ConversionStatus` types exist**: domain's (DB enum:
   `'received'|'pending'|'approved'|'declined'`, exported as `ConversionStatus`)
   and the connector's (`'pending'|'approved'|'declined'|'reversed'`, exported as
   `ProviderConversionStatus`). The worker's local status map targets the DB
   enum; `StubNetworkConnector.normaliseStatus` returns `ProviderConversionStatus`.
   The worker TODO is to delegate mapping to `connector.normaliseStatus()` via
   the connector registry — note the enum mismatch must be bridged there
   (e.g. provider `'reversed'` → adjustment flow, not an in-place status flip).
6. **`ReconciliationLine` carries no `programme_id`**. The reconciliation stub
   attributes all stub-connector lines to the single stub programme for the
   count/total comparison; a real connector export needs its own
   programme/account grouping key.
7. **`Connector` method shapes** (all confirmed): `validateUrl` is **async**;
   `ingestProducts(cursor?: string): Promise<ProductPage>`; `refreshOffers` returns
   `Promise<unknown[]>`; `handleWebhook` is **not** on the interface (stub-only
   method — fine). `refreshOffers` returning `OfferFixture[]` is assignable.
8. **`apiError`/`AppError` ARE used**: `AppError(code: ErrorCode, message, status)`
   with codes `VALIDATION_ERROR` (422, bad payload shape) and `INTERNAL` (500,
   missing org / processing failure). The `failed`-job log records `error.code`.
9. **`buildConversionEntries` deliberately NOT used.** It is ledger math owned
   by the API's finance module; importing it here would invite duplicating
   ledger posting in the worker.
10. **RawConversion shape validation is duplicated** in `provider-events.ts`
    (`parseRawConversion`) and `stub-network.ts` (`parseWebhookConversion`).
    The canonical home is a `parseRawConversion` helper in `@paparazzi/shared`;
    proposed as shared-module follow-up.

## DB assumptions

- Table/column names follow the task spec (`clicks.click_id` unique,
  `conversions` unique nulls-not-distinct on
  `(provider_account_id, source_transaction_id, line_id)`, `outbox` with
  `payload jsonb`, `payload_hash`, `published_at` nullable). Cross-checked
  against `shared/src/domain.ts`, whose docstring says it mirrors
  `db/migrations/0001_core.sql`.
- The `ON CONFLICT (provider_account_id, source_transaction_id, line_id)` target
  intentionally omits `org_id` per spec; note that two orgs sharing one
  provider account could collide on this constraint — the DB owner may want
  `org_id` in the unique key.
- `conversions.provider_revision` is `NOT NULL` in the domain model, so the
  worker inserts `raw.provider_revision ?? 0` (0 = "no revision info").
- `conversions.programme_id` is treated as NOT NULL: events without a
  programme are skipped with a warning, never inserted unattributed to a
  programme.

## Deliberate non-duplications

- **Ledger posting**: on `approved`, the worker only emits the outbox event.
  Double-entry posting with versioned split snapshots is the API finance
  module's job (explicit TODO in code).
- **Suspense resolution**: no auto-attribution path exists anywhere in this
  package, by design (see `src/suspense.ts` policy banner).

## Security / correctness notes

- `validateUrl` uses a literal `hostname.endsWith('stubmart.example')` per spec;
  this also matches `evilstubmart.example`. A production connector should
  require exact-or-proper-subdomain matching (and the redirect service already
  allowlists merchant domains independently).
- Outbox relay is at-least-once by design (XADD before `published_at` update);
  consumers must dedupe on `event_id`.
- `STUB_WEBHOOK_SECRET` must be set for the webhook demo flow; `handleWebhook`
  throws if absent. No secrets are hardcoded.
- The stub's purchase store is a module-level array: **ephemeral**, lost on
  restart, and not safe for multi-process use. Documented in code and README.
- Hash-mismatch jobs are logged and dropped with a TODO for a dead-letter
  queue; they are not retried (retry cannot fix tampering).
- `TrackedLink.url` in shared is documented as "fully-formed redirect URL
  served by the redirect service", but the build spec for this layer pins the
  stub's `createTrackedLink` to return the merchant URL with `?subid=`. The
  stub follows the build spec; the redirect-service wrapping belongs to the
  redirect package.

## Phase 3 (2026-09-22)

- The outbox relay needs no changes for the kill switch: `programme.paused`
  / `programme.resumed` are ordinary outbox rows and are published to the
  `events` stream like any other event (at-least-once; consumers dedupe on
  `envelope.event_id`). Corrections consumers should treat `programme.paused`
  as "stop accruing new exposure for this programme immediately".

## Retention purge (2026-09-22)

Mechanism for the open questions in `docs/counsel-briefing.md` §1
(DPDP retention schedules). The mechanism is window-agnostic; the numbers are
environment, not code.

1. **Defaults are conservative sandbox placeholders, not counsel's answer.**
   365 days per class (`RETENTION_CLICK_CONTEXT_DAYS`,
   `RETENTION_CONVERSION_RAW_DAYS`, `RETENTION_OUTBOX_DAYS`). The brief's
   90-day raw click-metadata figure is a planning assumption awaiting
   counsel's decision — counsel is expected to SHORTEN these. Per-class
   windows let counsel set e.g. 90 days for click context while keeping
   conversion raw payloads longer if accounting needs it.
2. **Nulling, not deleting, for clicks/conversions.** `conversions.click_id →
   clicks(id)` is a foreign key; `ledger_entries`/`adjustments` reference
   `conversions(id)`. Deleting rows would break referential integrity and the
   audit trail the ledger balances derive from. Payload columns (`context`,
   `raw`) are nullable already, so no migration was needed (no
   `0005_retention.sql`; the sibling's `0004_suspense_ops.sql` is untouched).
3. **Outbox rows are deleted, not nulled — published rows only.** The relay
   is at-least-once and consumers dedupe on `envelope.event_id`, so a relayed
   row carries no information that isn't already downstream. Unpublished rows
   are never deleted regardless of age.
4. **Deliberately out of scope:** `ledger_entries`, `audit_log`,
   `adjustments` (append-only financial/governance records; accounting
   obligations survive deletion requests — the purge SQL never names these
   tables except the audit INSERT); `disputes.evidence` (must survive dispute
   windows); `consent_records` (proof of consent is itself a legal record);
   `idempotency_keys.response` (API replay correctness, tiny). If counsel
   decides any of these need scheduled expiry, that is a separate,
   separately-audited job.
5. **Timestamp anchors:** `clicks.occurred_at` (the event the payload
   describes), `conversions.received_at` (platform intake of the provider
   report), `outbox.published_at` (relay completion — doubles as the
   never-delete-unpublished guard). Cutoffs are computed in TS as `Date`s,
   not SQL interval math (portable across pg-mem and Postgres).
6. **Audit convention** (audit_log has no details column):
   `action='retention.purge'`, `entity='<class>'`,
   `entity_id='{"window_days":N,"rows_affected":M}'`, `actor_id=NULL`
   (system job). One row per org per class per run, even when zero rows were
   affected — the row is evidence the scheduled purge ran for that tenant.
7. **pg-mem quirk (verified):** pg-mem misuses the partial index
   `idx_outbox_unpublished ... where published_at is null` and returns zero
   rows for any bare-column predicate on `published_at` in WHERE. The outbox
   class therefore uses `coalesce(published_at, now()) < $2`, which is
   semantically identical on real Postgres (NULL → now(), never older than a
   past cutoff) and evaluates correctly under pg-mem. One SQL path serves
   prod and tests; see the comment in `src/retention/purge.ts`.
8. **Statement reproducibility** is a tested invariant: earnings derive from
   `ledger_entries` balances and conversion money columns, never from the
   nulled blobs (`test/retention.test.ts` case (c) snapshots the
   earnings-style balances before/after a 0-day-window purge).
9. **Dry-run** (`--dry-run` CLI flag, `dryRun` option, `dry_run` job data)
   counts per class per org and writes nothing — no payload changes, no
   outbox deletes, no audit rows. Intended for verifying windows before the
   first real run.
