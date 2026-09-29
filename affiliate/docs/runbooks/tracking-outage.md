# Runbook: tracking outage

Clicks or conversions stop flowing (or flow partially). Money is at stake
only insofar as unattributed sales land in suspense; the ledger itself is
append-only and provider-sourced, so an outage delays attribution — it does
not invent or lose money once webhooks resume.

## Owner
On-call engineer (primary) + network_admin (for kill-switch decisions).

## Detection — what alert fires
- **Click volume drop**: `rate(click.observed)` (BullMQ `click-events` queue
  throughput / `clicks` row inserts per minute) falls > 50% vs the same
  weekday-hour trailing 4-week baseline for 10 minutes.
- **Redirect error spike**: 5xx rate on `GET /r/{token}` > 1% over 5 min, or
  p95 latency > 500 ms (load bar is p95 < 150 ms — see
  `scripts/load/redirect-soak.js`).
- **Webhook backlog**: provider event endpoint 5xx rate, or `conversions`
  `received_at` lagging `occurred_at` by > 30 min.
- Synthetic probe: a canary link minted hourly; alert if `/r/{token}` does
  not 302 within 2 s.

## Immediate containment (first 15 min)
1. Check `/healthz` on api + redirect; check Postgres and Redis reachability
   (`docker compose ps` / cloud console).
2. If the redirect service is down but the API/DB are up: clicks are being
   lost (fail-open design redirects only when the service answers). Pull the
   programme kill switch for affected programmes —
   `POST /v1/programmes/:id/pause` (network_admin) — so links serve the
   paused page instead of silently dropping attribution. **Do not** pause
   programmes for a partial/slow outage; a slow 302 still mints a click_id.
3. If Redis is down: no action needed for correctness — both services treat
   Redis as cache-only and fall back to the DB (logged). Expect higher DB
   load; watch connection counts.
4. If Postgres is down: the API and redirect cannot serve. Fail over per
   the DB runbook; do not invent clicks or conversions during the gap.

## Recovery
1. Restore the failing component; verify the canary link 302s with a fresh
   `subid`.
2. Backfill: provider webhooks are idempotent (dedupe on
   `(provider_account_id, source_transaction_id, line_id)`, revision-ordered)
   — ask the provider to redeliver any events in the outage window, or replay
   from the provider dashboard. Duplicates are safe.
3. Clicks lost during a full redirect outage cannot be reconstructed — mark
   the window in the incident log; conversions arriving with
   `returned_click_ref` values from that window will land in suspense
   (unattributed, never guessed) by design.
4. `resume` any paused programmes only after the canary passes for 15 min.

## Comms
- Internal: incident channel, then a 1-page postmortem within 48 h.
- Publishers: only if the outage exceeded 30 min or overlapped a payout
  window — post in the publisher portal banner: what happened, the affected
  window, and that no ledger entries were fabricated (suspense policy).
- Merchants: only if their webhook deliveries failed — share the redelivery
  request, not internal architecture.
