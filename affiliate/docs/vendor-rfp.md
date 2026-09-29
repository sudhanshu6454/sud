# Vendor Pricing Request — Paparazzi Affiliate Commerce Platform

## Open assumptions (to be confirmed with each vendor)

- The operating and contracting entity, consumer brand, and domain are not yet
  chosen (brief §17: "decisions to close in discovery").
- Merchant programme approvals are in flight but not yet granted; the build
  must support one approved network connector and one direct merchant at
  launch (§3, §6). Vendor proposals should name the concrete networks/brands
  they have integrated before, and price each additional connector separately.
- The internal planning envelope below is a transparent scenario, not a market
  quote and not a target to hit (§16).
- A sandbox reference implementation of the core product already exists in a
  company-owned repo; vendors should propose against the scope lots below, and
  may reference the existing schema/API where it reduces effort.

## Internal planning envelope (context only)

Internal estimate: 24–30 person-months across engineering, QA, design and
delivery at an assumed blended INR 1.5–2.5 lakh/person-month → INR 36–75 lakh
before contingency; +20% → **INR 43.2–90 lakh** for the initial platform
(§16). This excludes native apps, GST, content acquisition, partner minimum
guarantees, paid distribution and ongoing operations. Pilot hosting is
provisionally INR 0.5–2 lakh/month. Vendors are asked to price from their own
rates and resourcing — the envelope is provided so proposals can be sanity
checked, not matched.

## Scope lots — price each separately as fixed scope

Vendors must return a separate fixed-price estimate per lot. A combined
discount is acceptable only if each lot remains independently priced and
independently cancellable.

| Lot | Scope |
| --- | --- |
| L1 Discovery | 2-week spike: fresh data review, UX prototypes (360px mobile, tablet, desktop incl. loading/empty/stale-price/denied-consent/unavailable-merchant/offline/failed-sign-in states), connector capability matrix, contract templates, tracking spike proving one end-to-end click→conversion→reversal through the chosen network connector (§16 phase 1 exit criteria) |
| L2 Connector — network | One approved affiliate-network connector (e.g. Awin-style): capability discovery, URL validation, product ingestion, offer refresh, tracked link creation, conversion retrieval, status normalisation, reconciliation export (§6 connector contract). Includes sandbox/production credential handling via secrets manager and subpublisher-approval gating |
| L3 Connector — direct merchant | One direct ecommerce brand connector: authorised feed, signed server events, settlement report import, tested order/refund flow (§6 activation evidence) |
| L4 Storefront (web/PWA) | Consumer journeys §4: home/discovery, look detail with exact-vs-similar labels and affiliate disclosure, product detail with freshness timestamps, publisher storefronts, saved items with consent-gated alerts, search with category/size/budget/merchant filters. English + Hindi layouts, mobile-first, accessibility baselines (§4) |
| L5 Publisher portal | §5: programme directory, link builder + bulk import with row validation, disclosure-ready caption/media/QR export kits, dashboard (clicks, matched transactions, pending/approved/collected/paid), statement drilldown, missing-commission support tickets |
| L6 Editorial console | §7: content-to-commerce pipeline with workflow gates (Draft → Product review → Commercial review → Ready → Published → Paused/Withdrawn), rights/license metadata per asset, takedown propagation |
| L7 Ledger & finance | §9: append-only balanced double-entry ledger (integer minor units, explicit currency), versioned contract splits snapshotted per conversion, reversals as adjustments, merchant statement reconciliation, payout batch preparation with preparer/approver separation, idempotent payouts, dispute handling |
| L8 Testing & QA | §15: unit/contract/integration/E2E layers, load test per the acceptance targets (500 rps redirect, p95 <150ms, 99.9% availability), queue-replay and backup-restore reconciliation evidence, security assessment incl. pentest |
| L9 Handover | §18 handover package: numbered tickets with acceptance tests, schema + migrations, OpenAPI spec, connector capability matrix, ledger posting spec, reconciliation playbooks, publisher statements, policy configuration register, support runbooks, onboarding training, editorial/publisher manuals, 30-day defect support (§16) |

## Required in every proposal

1. **Named assumptions** for each lot — what the vendor assumed about data
   availability, merchant cooperation, content rights, and timelines.
2. **Day rates for changes** — named roles with per-day rates; change requests
   priced against these, not re-estimated from scratch.
3. **Milestone-to-acceptance mapping** — each invoice milestone must name the
   acceptance evidence that releases it (see below). No milestone is payable
   against a calendar date alone.
4. **Company ownership** — all work in company-owned repositories, CI/CD,
   cloud accounts, domains and secrets from day one; no vendor-held
   infrastructure (§16).
5. **Credential rotation procedure** — documented and demonstrated before
   production credentials are issued.
6. **Third-party licenses and recurring charges** — every dependency, SaaS,
   and per-seat/per-volume cost listed with its renewal terms.
7. **30-day defect support** in the delivery contract, starting at go-live
   sign-off (§18).

## Acceptance evidence (milestone release criteria)

Drawn from brief §15 verification tests and the §17 P0 launch backlog. Each
milestone must demonstrate the named tests with retained evidence (expected
result, actual result, owner). A critical tracking or money defect blocks the
associated milestone regardless of schedule.

| Milestone | Required acceptance evidence |
| --- | --- |
| M1 Discovery complete | Tracking spike: one end-to-end transaction through each live connector incl. return/reversal evidence (§3 MVP gate); connector capability matrix; approved UX prototypes; contract templates |
| M2 Core product | Link creation denied for unapproved property even when publisher and merchant exist; unsupported merchant yields no commissionable link (clear onboarding/untracked option); look workflow gates enforced; stale/removed offer shows labelled fallback with no fabricated price |
| M3 Attribution | Tracked conversion: returned reference maps to the correct publisher, property, placement and frozen contract version; 10 identical callbacks + polling create exactly one conversion and one financial effect; delayed "pending" cannot overwrite "approved"; legitimate reversal creates an adjustment entry; missing reference lands in suspense — no guessed payout |
| M4 Money | Partial return: INR 160 commission at 70% split with 50% reversal leaves INR 56 publisher / INR 24 platform; partial collection: only funded eligible lines (or documented pro-rata) enter a payout batch; preparer cannot approve own batch; unknown bank outcome: status query before retry, one transfer only; failed financial-integrity check blocks payout release |
| M5 Security & privacy | Tenant isolation: publisher A cannot read/export/mutate publisher B records or assets; consent denial: shopping works, disallowed tracking and SDK calls do not fire; SSRF guards on feed fetching; secrets in secrets manager |
| M6 Reliability | 500 rps redirect soak (15 min) with p95 service processing <150ms excl. merchant time; error rate <1%; queue replay and backup-restore reconcile with no money duplication; kill switch stops new links and surfaces corrections (§7) |
| M7 Pilot readiness | All §17 P0 items closed: verified properties and programme capabilities; reviewed looks, licensed offers, compliant links; reliable conversions, reconciliation and payout controls; tenant isolation, disclosures and failure states. Go-live sign-off by product, editorial, engineering, finance and partnerships (§15) |

## Commercial terms to quote

- Fixed price per lot (L1–L9) with named assumptions.
- Day rates per role for out-of-scope changes.
- Payment schedule expressed as "M1…M7 evidence delivered → invoice", with a
  minimum 20% retention on M7 until 30-day defect support completes.
- Proposed team composition and named technical lead.
- Proposed hosting/cloud bill for the pilot (validate against the provisional
  INR 0.5–2 lakh/month), with the cost drivers itemised (video bandwidth,
  catalogue refresh volume, event pipeline).

## Evaluation

Proposals are evaluated on: demonstrated affiliate/tracking integrations
(referenceable), ledger and reconciliation competence, evidence discipline
(acceptance artefacts, not slideware), and the completeness of assumptions and
recurring-cost disclosure. The lowest price does not win; the most honest
scope does.
