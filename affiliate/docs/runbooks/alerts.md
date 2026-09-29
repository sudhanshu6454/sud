# Alert guide — what each alert means and why its threshold is what it is

Companion to `docs/monitoring/alerts.yaml` (the definitions of record).
**Status: defined, not wired.** Wiring these to the real monitoring stack
(CloudWatch alarms / Route 53 health checks / SNS under Option A, or the DO
equivalents under Option B — see `docs/infrastructure-recommendation.md`
§ Monitoring) is **PENDING INFRA**. Nothing here fires today; do not
describe these alerts as live.

Each section: what the alert watches, threshold rationale, and the runbook
to open when it fires.

## click-volume-drop — `docs/runbooks/tracking-outage.md`

**Watches:** rate of `click.observed` events (BullMQ `click-events`
throughput / `clicks` inserts per minute) vs a same-weekday-hour,
trailing-4-week baseline.

**Rationale:** the redirect path is deliberately fail-open
(`packages/redirect/src/index.ts` step 5) — if persistence fails, users
still 302 and nothing errors. So error-rate alerts can stay green while
attribution silently dies. Volume is the only honest signal for that
failure mode. The 50% drop line keeps false positives low against normal
traffic shape; 10 minutes of persistence filters deploys and hiccups.

## redirect-5xx-rate — `docs/runbooks/tracking-outage.md`

**Watches:** 5xx share on `GET /r/{token}` > 1% over 5 minutes.

**Rationale:** the click path should be near-zero 5xx outside deploys
(token validation, cache lookup, one DB insert). 1% over 5 minutes is
enough to be user-visible at pilot scale (≤10k redirects/day) without
paging for a single bad deploy second.

## redirect-p95-latency — `docs/runbooks/tracking-outage.md`

**Watches:** p95 latency on the redirect path > 500 ms over 10 minutes.

**Rationale:** the load bar is p95 < 150 ms
(`scripts/load/redirect-soak.js`). 500 ms is the line where mobile
drop-off rises and downstream timeouts (merchant pages, queue producers)
start cascading. Warning, not critical: slow is not down, and the
fail-open design still mints click_ids — but sustained slowness at pilot
scale usually means Redis is degraded and every click is hitting Postgres.

## redirect-canary-failure — `docs/runbooks/tracking-outage.md`

**Watches:** hourly synthetic probe — mint a canary link, follow it, fail
if not a 302 to the expected host within 2 s.

**Rationale:** catches silent corruption the other alerts miss: cache
entries poisoned across a pause/resume flip, 302s that lost the `subid`
(click still counted but unattributable), or a paused page served where an
active link should be. One failed check pages because a canary failure is
never ambient noise — the probe path is fully controlled.

## webhook-event-backlog — `docs/runbooks/tracking-outage.md`

**Watches:** conversion event lag (`received_at − occurred_at`) > 30 min,
or 5xx > 1% over 5 min on the ingestion endpoints.

**Rationale:** the ingest state machine is idempotent and
revision-ordered (`packages/api/src/conversion-ingest.ts`), so duplicates
and bursts are safe — the dangerous shape is *staleness*: events sitting
unprocessed stall the ledger, suspense aging, and publisher statements.
30 minutes is generous for provider delivery jitter but tight enough to
catch a wedged queue before it becomes a payout-cycle problem. Escalates to
critical at 2 h of lag.

## settlement-gap — `docs/runbooks/merchant-nonpayment.md`

**Watches:** per programme, approved conversions in the last 14 days with
zero `merchant_settlements` rows in the same window (evaluated daily).

**Rationale:** payouts are capped by collected cash
(`computeCollectedAllocation`, `packages/api/src/finance.ts`), so the
platform's exposure to a non-paying merchant is publisher trust, not cash —
but trust erodes silently. 14 days covers a normal settlement cadence;
the alert is the *earliest* automated signal, ahead of the human dunning
signal. Zero-settlement with real approved volume is never normal.

## collected-cash-ratio-drop — `docs/runbooks/merchant-nonpayment.md`

**Watches:** per (programme, currency), collected cash ÷ approved
publisher liability < 20% at payout-prepare time, two consecutive cycles.

**Rationale:** companion to `settlement-gap`: catches *partial* or
*slow* payment where some settlements exist (so the binary gap alert
stays quiet) but publishers are being paid out at a shrinking fraction of
what they've earned. Two consecutive cycles rules out a single late
remittance. 20% is deliberately low — this fires only when the programme
is materially behind, i.e. a dunning conversation is already overdue.

## books-balanced-sweep

**Watches:** hourly scheduled job runs `checkBooksBalanced()`
(`packages/shared/src/ledger.ts`, same logic as the payout-prepare gate
`assertBooksBalancedOrThrow` in `packages/api/src/finance.ts:572`) over
`ledger_entries` per (org, currency). Any non-zero imbalance pages.

**Rationale:** the ledger is the money of record and is append-only;
double-entry balance is an invariant, not a business metric. Any imbalance
means a corrupt writer (a code bug in a ledger builder, an unsafe manual
SQL session, or a failed migration), never a legitimate business state.
The payout gate already 409s (`LEDGER_IMBALANCE`), so money cannot move
on broken books — the alert exists to make the corruption *visible*
instead of silently discovered at the next payout cycle.

**Runbook:** no dedicated ledger-imbalance runbook exists yet — this is a
documented gap (the `alerts.yaml` entry links here as interim). If it
fires:
1. Confirm the imbalance with the sweep output (org, currency, amounts).
2. Do NOT hand-post compensating ledger entries to "fix" the balance —
   the ledger is append-only; a balancing entry would destroy the audit
   trail of the original corruption. Page engineering immediately.
3. Check `audit_log` and deploy history for writes near the imbalance's
   `created_at`; suspect order: recent code change to a ledger builder >
   manual SQL session > migration bug.
4. Payouts for the affected (org, currency) are already blocked by the
   409 gate — communicate the hold to finance, do not override it.
5. Follow up: write the dedicated runbook from the postmortem.

**Gap note:** `docs/runbooks/` currently covers tracking outages,
merchant non-payment, publisher fraud, data incidents, backup/restore,
and wrong-product-rights. A ledger-imbalance runbook should be added
pre-launch; until then this section is the procedure.

## Cross-cutting notes

- **Severity semantics:** `critical` pages (SNS → on-call, 15-min
  response); `warning` notifies (Slack, same business day). Escalation
  rules in `alerts.yaml` (webhook lag → critical at 2 h, settlement gap →
  critical past cure period) are evaluated by the responder, not the
  alerting system, until runbook automation exists.
- **False-positive budget:** pilot thresholds are intentionally loose
  (50% drops, 1% error rates) because pilot traffic is thin and noisy.
  Tighten after 4 weeks of baseline data — record any change in this file
  with a date.
- **Demo/mock data must never feed these metrics.** The web app's
  `withDemoFallback` demo mode (`packages/web`) renders mock data when
  the API is unreachable; metric publishers (redirect service, workers,
  the sweep job) must read only real stores. If a metric source is
  unreachable, emit nothing — never synthesize.
- **Alert fire-drill:** before pilot launch, trigger each alert
  synthetically (staging) and record the drill date in `alerts.yaml`.
  An alert that has never fired is an alert you do not trust.
