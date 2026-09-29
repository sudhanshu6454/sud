# @paparazzi/api

Public v1 API for the Paparazzi Affiliate Commerce Platform. Fastify 4 + TypeScript (strict).

## Run

```bash
# from the repo root
pnpm --filter @paparazzi/api dev
```

Env vars:

| Var | Default | Purpose |
|---|---|---|
| `API_PORT` | `3000` | Listen port |
| `API_HOST` | `0.0.0.0` | Listen host |
| `DATABASE_URL` | — (required) | Postgres connection string |
| `REDIS_URL` | — (optional in development; **required** under `NODE_ENV=production`, boot fails without it) | Redis for link-route cache warming and kill-switch invalidation; outside production the API works without it |
| `TRUST_PROXY` | unset = trust nothing | Which peers may set X-Forwarded-For for `req.ip` (`true`, a hop count, or a comma list of addresses / CIDRs / `loopback`, `linklocal`, `uniquelocal`; invalid → boot fails). docker-compose.prod.yml: `loopback,uniquelocal`. The request log never records the address |
| `JWT_SECRET` | — (required) | Signs/verifies API JWTs; also HMAC-signs link tokens (dev-grade, see ASSUMPTIONS.md) |
| `REDIRECT_BASE_URL` | `http://localhost:3001` | Base URL used to build `/r/{token}` links |

## Auth

All `/v1/*` routes require `Authorization: Bearer <jwt>` with claims
`{ sub, org_id, role }`. Failures return `401 UNAUTHORIZED`.
The tenant (`org_id`) comes from the token — every query is scoped to it.

Minimal role matrix (full RBAC is a TODO):

| Route | Allowed roles |
|---|---|
| `POST /v1/links` | `publisher_owner`, `editor`, `network_admin` |
| `POST /v1/integrations/:connector/events` | `network_admin`, `editor` |
| `POST /v1/payout-batches` (prepare) | `finance_operator`, `finance_approver`, `network_admin` |
| `POST /v1/payout-batches/:id/approve` | `finance_approver`, `network_admin` (maker≠checker enforced) |
| everything else under `/v1` | any authenticated role |

### Dev token

```bash
JWT_SECRET=dev-secret node scripts/mint-dev-token.mjs \
  --sub user-123 --org-id org-abc --role network_admin
# LOCAL TESTING ONLY — the script says so at the top, loudly.
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Liveness probe, no auth → `{ ok: true }` |
| `GET` | `/v1/looks?page=&page_size=&locale=&category=` | Published looks, paginated; each item carries `source_page`, `sponsored`, `cover_url`, `item_count` |
| `GET` | `/v1/looks/{id}?placement_id=` | One look with items, the live offer per item and (with `placement_id`) the tracked link; drafts visible to `editor`/`network_admin` only, else 404 |
| `GET` | `/v1/offers?variant_id=&programme_id=` | Live offers only (`active` + `fresh_until > now()`) |
| `POST` | `/v1/links` | Mint a tracked link `{property_id, programme_id, offer_id, placement_id}` → `201 { token, url }` |
| `POST` | `/v1/integrations/{connector}/events` | Provider conversion notification → `202`; connector allowlist: `stub-network` |
| `POST` | `/v1/integrations/csv/uploads` | File-based merchant settlement import (see CSV format below) → `202`; roles: `network_admin`, `editor` |
| `GET` | `/v1/publisher/earnings?publisher_id=` | Per-currency `{ pending, approved, collected, payable }` |
| `POST` | `/v1/payout-batches` | Prepare payout batch `{currency}` → `201` (books-balanced gate) |
| `POST` | `/v1/payout-batches/{id}/approve` | Approve batch (maker-checker) → `200` |

## Envelopes

Success: `{ "data": <...>, "request_id": "<uuid>" }`
(paginated lists add `page`, `page_size`, `total` inside `data`).

Error: `{ "error": { "code": "<CODE>", "message": "<...>", "request_id": "<uuid>" } }`
with the matching HTTP status. Every response carries `X-Request-Id`.

## Idempotency

POST routes accept an `Idempotency-Key` header. The first response
`{status, body}` is stored per `(key, org_id)`; a retry with the same key
replays the original response with `X-Idempotent-Replay: true` instead of
re-executing. 5xx responses are never cached. There is no request-body
fingerprinting and no distributed lock — row-level idempotency keys on
writes (`ledger_entries`, `payout_batches`) are the second line of defense.

## Money

All money is integer minor units (paise for INR). Postgres `bigint`
columns arrive as strings and are converted via `assertMinorUnits` from
`@paparazzi/shared` before any arithmetic.

## Attribution policy

Unknown attribution stays unknown: a conversion whose `returned_click_ref`
matches no click is stored with `click_id = NULL` (suspense) and is never
assigned to a publisher — it earns nothing and posts no ledger entries.

## CSV settlement uploads (`POST /v1/integrations/csv/uploads`)

Brief §8: direct merchants without APIs report via files. The request body
is `{ provider_account_id, programme_id, filename, csv_text }` — the CSV is
sent as an inline string (no multipart parsing; deliberate sandbox choice).

**Column format** — header row required, names case-insensitive, extra
columns ignored, blank lines skipped, UTF-8, LF or CRLF:

| column | required | notes |
|---|---|---|
| `source_transaction_id` | yes | provider's transaction id (≤200 chars) |
| `line_id` | no | provider's line-item id; empty = null |
| `returned_click_ref` | no | matched against `clicks.click_id`; unknown or empty → suspense (never guessed) |
| `currency` | yes | 3-letter code, e.g. `INR` (case-insensitive, stored uppercase) |
| `eligible_value_minor` | yes | integer ≥ 0 in minor units (paise for INR); **decimals rejected** |
| `commission_minor` | yes | integer ≥ 0 in minor units; **decimals rejected** |
| `provider_status` | yes | `approved`\|`pending`\|`declined`\|`reversed` (case-insensitive); `reversed` behaves as `declined` after approval (auto-reversal adjustment), as on the webhook path |
| `provider_revision` | no | integer ≥ 0, default 0; same ordering rules as the webhook path — stale revisions are ignored, an approval is never downgraded |
| `occurred_at` | yes | ISO 8601 datetime, e.g. `2026-09-20T10:00:00.000Z` |

Money is always integer minor units — a value like `12.50` is rejected with
a clear reason, not rounded or truncated.

The uploader names the `programme_id` (must be active and org-owned;
contrast the webhook path, which resolves the programme from the click
chain). Every row goes through the **same conversion pipeline** as the
provider webhook (`src/conversion-ingest.ts`): idempotency on
`(provider_account_id, source_transaction_id, line_id)`, revision ordering,
suspense on unknown click refs, ledger posting on approved, and the same
outbox events (`conversion.received` / `.status_changed` / `.reversed`).

**All-or-nothing validation**: every row is validated before anything is
ingested. Any invalid row rejects the whole file with `422
VALIDATION_ERROR` and per-row `errors: [{row, reason}]` (row = 1-based
data-row number; `row: 0` = file-level problem) — nothing is inserted.

Sample: `packages/api/test/fixtures/sample-settlement.csv`.
