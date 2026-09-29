# @paparazzi/shared

The cross-package contract for the Paparazzi Affiliate Commerce Platform.
Every other package (`api`, `redirect`, `workers`, `web`) codes against these
exports — **names and signatures are stable; do not rename without a
coordinated migration**.

## Contents

| Module | Provides |
|---|---|
| `errors.ts` | `ERROR_CODES` tuple, `ErrorCode`, `ApiErrorBody`, `apiError()`, `AppError` |
| `events.ts` | `EVENT_SCHEMA_VERSION`, `EventEnvelope`, `canonicalJson()`, `hashPayload()`, `buildEnvelope()` |
| `hash.ts` | `sha256Hex()` — pure-TypeScript SHA-256 (zero dependencies) |
| `domain.ts` | `MinorUnits`, `assertMinorUnits()`, entity interfaces mirroring `db/migrations/0001_core.sql` |
| `connectors.ts` | `Connector` interface, `CapabilityError`, capabilities / conversion / reconciliation types |
| `ledger.ts` | `LedgerAccount`, `LedgerEntryDraft`, `assertEntriesBalanced()`, `buildConversionEntries()`, `buildAdjustmentEntries()`, `checkBooksBalanced()` |
| `trust-proxy.ts` | `parseTrustProxy()` — `TRUST_PROXY` → Fastify `trustProxy` (unset = trust nothing; `true`, a hop count, or a comma list of addresses / CIDRs / `loopback`, `linklocal`, `uniquelocal`; anything else throws at boot), shared by the api and the redirect (`trust-proxy.test.ts`) |
| `request-log.ts` | `requestLogFields()` — the api's and the redirect's request-log serializer: method, url, hostname, never the client address |

## Conventions

- **Money is integer minor units everywhere** (`MinorUnits = number`). Negatives
  are rejected by `assertMinorUnits`; deductions are positive amounts on the
  opposite ledger side.
- **IDs are UUID strings; timestamps are ISO 8601 strings** (as `pg` returns them).
- **Zero runtime dependencies.** This package has no `dependencies` so it can be
  imported anywhere (edge, workers, browser) without dragging in `pg` or crypto
  bindings. See [ASSUMPTIONS.md](./ASSUMPTIONS.md).
- Imports use explicit `.js` extensions (NodeNext resolution).

## Typecheck

```sh
npx tsc -p tsconfig.json --noEmit
```
