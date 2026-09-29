# @paparazzi/workers

Integration workers for the Paparazzi Affiliate Commerce Platform: provider event
normalisation, feed ingestion, reconciliation, click observation, and the
transactional outbox relay. TypeScript strict, BullMQ 5 + ioredis 5, `pg` 8.

## Queue / worker map

| Queue | Worker module | Job data | What it does |
|---|---|---|---|
| `click-events` | `src/workers/click-events.ts` | `{ envelope: EventEnvelope }` | Verifies `hashPayload(payload)` against `envelope.payload_hash`, logs `click.observed {click_id}`. Aggregation into analytics is a TODO (analytics never touches money). |
| `provider-events` | `src/workers/provider-events.ts` | `{ envelope: EventEnvelope }` (payload = `RawConversion`) | Validates shape, asserts integer minor units, resolves `programme_id`, maps `returned_click_ref` → `clicks.id` (NULL on no match → **suspense**), inserts idempotently, writes a transactional outbox row `conversion.normalized`. |
| `feeds` | `src/workers/feeds.ts` | `{ connector?, since? }` | **Stub.** Logs "feed ingest not configured for this run". TODO: incremental ingestion with checkpoints. |
| `reconciliation` | `src/workers/reconciliation.ts` | `{ org_id, from?, to? }` | **Stub.** Calls the stub connector's `exportReconciliation({from,to})`, compares counts/totals per programme against `conversions`, logs gaps. TODO: statement line matching + dispute creation (finance-owned). |
| `retention` | `src/workers/retention.ts` | `{ dry_run? }` | DPDP retention purge: nulls aged `clicks.context` / `conversions.raw` payloads and deletes aged **published** outbox rows, per org. Never touches ledger/audit/adjustments. See "Retention purge" below. |

Queue names are exported as constants from `src/queues.ts`
(`QUEUE_CLICK_EVENTS`, …). Producers (API, redirect service) enqueue through the
exported `Queue` instances. Every worker gets its **own** Redis connection —
BullMQ requires `maxRetriesPerRequest: null` and a Worker must never share a
connection with producers.

## Outbox relay design

Business writes commit outbox rows in the **same DB transaction** as the domain
change (see `provider-events.ts`). `src/outbox.ts` `startOutboxRelay(pool, redis)`
polls every 5000 ms:

1. `SELECT … FROM outbox WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED`
2. For each row: `XADD events * envelope <envelope JSON>`
3. `UPDATE outbox SET published_at = now() WHERE id = $1`

Delivery is **at-least-once** (stream append happens before the `published_at`
mark, so a crash between the two republishes). Consumers must dedupe on
`envelope.event_id` and may re-verify `payload_hash`. `stop()` halts the
interval for graceful shutdown.

## Suspense-queue policy

`src/suspense.ts` → `listSuspenseQueue(pool, org_id, limit)` returns conversions
with `click_id IS NULL` and `status <> 'declined'`, newest first.

> **Unknown attribution stays unknown.** A conversion whose `returned_click_ref`
> matches no click is stored unattributed for **human** review by finance /
> publisher operations. Never auto-attribute from IP, timestamps, device
> fingerprints, or "likely" patterns. A user screenshot alone must not create a
> payable sale. Resolving a suspense item requires deterministic evidence
> (e.g. an amended provider report carrying the click reference) plus actor,
> reason, and timestamp.

## Retention purge

`src/retention/` implements the DPDP-aligned retention job (tied to the open
questions in `docs/counsel-briefing.md` §1). Three data classes, three
configurable windows:

| Class | What is purged | Window measured from | Default |
|---|---|---|---|
| `click_context` | `clicks.context` → NULL (raw click metadata) | `clicks.occurred_at` | 365 days |
| `conversion_raw` | `conversions.raw` → NULL (raw provider payload) | `conversions.received_at` | 365 days |
| `outbox` | whole row **deleted**, published rows only | `outbox.published_at` | 365 days |

Environment: `RETENTION_CLICK_CONTEXT_DAYS`, `RETENTION_CONVERSION_RAW_DAYS`,
`RETENTION_OUTBOX_DAYS` (default 365 each; invalid values fall back to the
default with a warning — a misconfigured window never silently widens
retention). The 365-day defaults are conservative sandbox placeholders;
counsel is expected to shorten them (the brief's 90-day figure is a planning
assumption, not a decision). No migration is needed: nulling payload columns
requires no schema change.

**Why nulling, not deleting, for clicks/conversions:**
`conversions.click_id → clicks(id)` is a foreign key and ledger/adjustment
rows reference conversions — deleting rows would break referential and audit
integrity. Nulling only the free-text payload columns keeps every row, key,
and money figure intact.

**Invariants (tested):**
- `ledger_entries`, `audit_log`, and `adjustments` are **never** touched —
  the purge SQL does not name them (except the audit INSERT). Accounting
  records survive deletion requests.
- Publisher statements stay reproducible: earnings derive from ledger
  balances and conversion money columns, never from the nulled blobs.
- Outbox: only rows with `published_at` set (relay completed, at-least-once;
  consumers dedupe on `envelope.event_id`) are deleted. Unpublished rows are
  kept regardless of age.

**Tenancy:** the job loops organisations — one transaction per org covering
the three class statements plus the three audit rows (atomic per tenant).
Every statement carries an explicit `org_id` predicate.

**Audit:** one `audit_log` row per org per class per run:
`action='retention.purge'`, `entity='<class>'`,
`entity_id='{"window_days":N,"rows_affected":M}'` (machine-readable; the table
has no details column), `actor_id=NULL` (system job). Rows are written even
when `rows_affected=0` — the row is evidence the scheduled purge ran.

**Running it:**

```bash
# one-off (same code path as the scheduled job)
pnpm --filter @paparazzi/workers purge:retention
pnpm --filter @paparazzi/workers purge:retention -- --dry-run   # report only, write nothing

# scheduled: the workers bootstrap registers a BullMQ repeatable job on the
# `retention` queue at startup (pattern from RETENTION_CRON, default '0 3 * * *')
DATABASE_URL=<redacted> pnpm --filter @paparazzi/workers dev
```

## Stub connector demo flow

`src/connectors/stub-network.ts` (`StubNetworkConnector`, `name='stub-network'`)
plus `src/connectors/fixtures.ts` (merchant `merch_stub_1` "StubMart", programme
`prog_stub_1`, INR capabilities, 3 offers). The purchase store is an **ephemeral
module-level array** — restarts wipe it.

End-to-end local demo:

```
1. link    = await connector.createTrackedLink({ offer_id: 'offer_1', placement_id: 'plc_1' })
             // url: https://stubmart.example/p/offer_1?subid=<uuid>   (click_ref_field: 'subid')
2. Record a click row with click_id = <uuid from the subid>  (redirect service does this)
3. conv    = connector.simulatePurchase('<uuid>', 200000)     // INR 2,000.00, 8% commission
4. body    = JSON.stringify(conv)
   sig     = HMAC-SHA256 hex of body with STUB_WEBHOOK_SECRET
   raw     = connector.handleWebhook(body, sig)               // throws on bad signature
5. envelope = buildEnvelope('provider.conversion', raw)       // API layer
   await providerEventsQueue.add('conversion', { envelope })  // API layer
6. provider-events worker: validates, matches click, inserts conversion,
   emits outbox row 'conversion.normalized' → relay → `events` stream
7. Mismatched/absent subid → conversion stored with click_id NULL → suspense queue
```

`handleWebhook` uses `timingSafeEqual` against the HMAC of the **raw body**;
`simulatePurchase` computes commission as `floor(amountMinor * 800 / 10000)`.
`ingestProducts()` throws `CapabilityError` (typed unsupported-capability demo).

## Running

```bash
# from repo root
DATABASE_URL=postgres://… REDIS_URL=redis://127.0.0.1:6379 \
  STUB_WEBHOOK_SECRET=dev-secret \
  pnpm --filter @paparazzi/workers dev

# typecheck
npx tsc -p packages/workers/tsconfig.json --noEmit
```

Graceful shutdown: `SIGTERM`/`SIGINT` stops the relay, closes workers and
queues, quits Redis connections, and drains the pg pool.

## Layout

```
src/
  index.ts                 bootstrap: 5 workers + outbox relay + shutdown
  queues.ts                queue name constants, Redis factory, Queue instances
  outbox.ts                startOutboxRelay / relayOutboxBatch  (-> `events` stream)
  suspense.ts              listSuspenseQueue (human-review read model)
  logging.ts               tiny JSON logger
  retention/
    config.ts              RETENTION_* env windows (default 365d), cron pattern
    purge.ts               runRetentionPurge: per-org purge + audit (tested)
    run-once.ts            CLI: pnpm --filter @paparazzi/workers purge:retention
  workers/
    click-events.ts        envelope check + click.observed log
    provider-events.ts     RawConversion normalisation (idempotent, transactional outbox)
    feeds.ts               stub
    reconciliation.ts      stub comparison vs stub connector export
    retention.ts           BullMQ wrapper + scheduleRetentionRepeat (daily)
  connectors/
    fixtures.ts            StubMart merchant / programme / capabilities / offers
    stub-network.ts        StubNetworkConnector implements Connector
```

See `ASSUMPTIONS.md` for contract risks and deliberate non-duplications
(ledger posting lives in the API's finance module, not here).
