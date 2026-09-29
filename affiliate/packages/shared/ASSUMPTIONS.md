# @paparazzi/shared — ASSUMPTIONS

Decisions baked into this package. Recorded here so the integrator can
challenge them deliberately rather than discover them by accident.

## 1. MinorUnits is `number`, not `bigint`, not a branded type

Money is `type MinorUnits = number` plus a runtime assertion
(`assertMinorUnits`) instead of a branded/opaque type or `bigint`.

- **Why number:** JSON-safe (events, outbox payloads, API bodies all serialize
  without custom replacers), matches `pg`'s numeric handling for values under
  2^53, and keeps arithmetic (`floor(commission*bps/10000)`) readable.
- **Why not branded:** branded types would force every consumer through
  constructors; the assertion-at-boundary pattern is lighter and was specified
  in the build contract.
- **Risk:** nothing stops a caller from passing a plain float where MinorUnits
  is expected. Mitigation: call `assertMinorUnits` at trust boundaries
  (API input validation, worker ingestion).

## 2. `checkBooksBalanced` takes an injected query function

Signature: `checkBooksBalanced(query, org_id)` where
`query: (sql, params) => Promise<{ rows: [...] }>`.

- **Why:** importing `pg` here would give every consumer (including `web`)
  a database driver dependency. Injection keeps `shared` dependency-free and
  lets callers pass a transaction-scoped client in tests.
- The SQL is fixed inside the function
  (`select currency, sum(debit_minor) as debit, sum(credit_minor) as credit
  from ledger_entries where org_id=$1 group by currency`); sums are compared
  as `BigInt` because drivers return `bigint` columns as strings.

## 3. Canonical-JSON hashing is self-contained

`hashPayload` = SHA-256 (hex) over canonical JSON with recursively sorted
keys. The SHA-256 implementation is pure TypeScript in `hash.ts` rather than
`node:crypto`.

- **Why:** `@types/node` is not resolvable from this package (it lives under
  `packages/api/node_modules`), and adding it would couple the shared contract
  to Node typings. Pure TS keeps the package runnable in any JS runtime.
- Canonical form: key-sorted objects, arrays in order, `undefined` values
  dropped (matching `JSON.stringify`), non-finite numbers throw.
- **Risk:** a hand-rolled SHA-256 must be correct. It is the standard
  FIPS-180-4 construction; verify with the known vector
  `sha256Hex('abc') = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`
  before trusting it in production.

## 4. `event_id` randomness

`buildEnvelope` generates UUID v4 using `globalThis.crypto.getRandomValues`
when available, with a `Math.random` fallback for exotic runtimes. Event ids
are identifiers, not secrets, so the fallback is acceptable.

## 5. Contract questions for the integrator (implemented as specified)

- `ConversionStatus` in `connectors.ts` is `'pending'|'approved'|'declined'|'reversed'`
  while `domain.ts` `ConversionStatus` (the DB column) is
  `'received'|'pending'|'approved'|'declined'`. The connector-side `'reversed'`
  has no DB-side counterpart — reversals are modelled as `Adjustment` rows.
  Because the two types share a name but differ, the barrel export
  (`index.ts`) re-exports `domain.ts`'s `ConversionStatus` as-is and aliases
  the connector one to `ProviderConversionStatus`. Consumers needing the
  connector type by its original name can import from
  `@paparazzi/shared/src/connectors.js` directly.
- `ReconciliationLine` has no prescribed shape in the contract; the fields
  chosen mirror `RawConversion` minus attribution fields.
- `Connector.ingestProducts` returns `ProductPage { products: unknown[]; nextCursor?: string }`
  and `refreshOffers` returns `unknown[]` — intentionally loose until the
  catalogue workstream defines product/offer DTOs.
- `LedgerEntry.publisher_id` is `string | null` (conversion-level entries may
  not yet know the publisher; payout-time entries will).

## Integration (2026-09-22)
- `publisher_id` and `memo` were added to `LedgerEntryDraft`,
  `BuildConversionEntriesParams`, and `BuildAdjustmentEntriesParams` at
  integration time: `ledger_entries.publisher_id` exists in the schema and
  per-publisher payout accounting needs it on every draft.

## Integration (2026-09-22, phase 3)

- New error code `PUBLISHER_NOT_ACTIVE` (403): `POST /v1/links` when the
  publisher's onboarding state machine has not reached `active`.
