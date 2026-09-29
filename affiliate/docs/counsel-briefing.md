# Counsel Briefing — Decisions and Questions Before Launch

*This document frames questions for legal counsel. It states no legal
conclusions. Every item marked **[DECISION]** needs counsel's answer before
the associated go-live gate.*

## Open assumptions (facts counsel should validate)

- Operating and contracting entity, consumer brand, and domain are not yet
  chosen (§17). Several questions below depend on the entity and jurisdiction.
- Product: India-first, INR storefront (English/Hindi); web/PWA first, native
  apps later. Merchant checkout; the platform never holds inventory, processes
  payments, or holds customer funds (§1).
- Publisher model at launch: managed subpublisher (company receives merchant
  commission and shares it with contracted publishers) plus owned network;
  publisher-owned-account model is supported as a separate contract type (§3).
- The brief's positions are planning assumptions, not legal advice: DPDP
  Rules 2025 phased commencement (§14), ASCI disclosure (§14), principal vs
  agent and tax treatment (§9), raw click metadata retention of 90 days (§14).

---

## 1. DPDP Rules 2025 — phased commencement

The official MeitY notification provides for phased commencement; the brief
explicitly does not assume all obligations commenced together (§14, S6).

- **[DECISION]** Which provisions are in force at our planned launch date,
  and which commence later? Please provide a dated commencement map.
- **[DECISION]** What must be built **now** regardless of phase: purpose-
  specific notices, consent collection and versioned consent records,
  withdrawal and deletion-request workflows, grievance handling and redressal
  timelines, data inventory, retention schedules?
- **[DECISION]** Is the proposed 90-day raw click-metadata retention
  defensible, or should a different period apply per data class? What are the
  accounting-record retention obligations that survive a deletion request
  (§11 data lifecycle)?
- **[DECISION]** Data principal rights workflows: what response timelines and
  evidence standards apply to access/correction/erasure requests against our
  ledger and analytics stores?
- **[DECISION]** Any registration, reporting or Data Protection Board
  interaction required of the operating entity before processing begins?

> **Implementation note (2026-09-22, sandbox):** the retention *mechanism*
> exists and is window-agnostic — `packages/workers/src/retention/`
> (per-org purge, one transaction per tenant) runs daily via a BullMQ
> repeatable job plus an on-demand CLI (`pnpm --filter @paparazzi/workers
> purge:retention`, with `--dry-run`). Defaults are 365 days per data class
> (raw click context, raw provider payloads, published outbox rows),
> configurable via `RETENTION_*` environment variables; payload columns are
> nulled rather than rows deleted, and `ledger_entries`, `audit_log`, and
> `adjustments` are never touched (publisher statements remain reproducible
> from the ledger). Each run writes `retention.purge` audit rows. The window
> lengths themselves remain counsel's decision — no legal position is taken
> here.

## 2. Minors

- **[DECISION]** The brief requires a minors policy before public sign-up
  (§14). What age threshold and what verifiable parental-consent mechanism
  apply? Does any part of the product (alerts, saved items, personalised
  feeds) require changes if under-18 users are present?

## 3. ASCI disclosure — influencer advertising

ASCI requires identifiable disclosure for advertising with a material
connection (§14, S5). Our formats: short video, captions, publisher-shared
collections, landing pages.

- **[DECISION]** What exact disclosure labels and placement satisfy ASCI for
  each of our formats (video overlay vs caption text vs landing-page banner)?
  Is "#ad" equivalent acceptable, or is programme-specific wording required?
- **[DECISION]** Who signs off the disclosure wording — counsel once per
  template, or per campaign? What audit trail is sufficient to prove
  disclosure was present at publish time?
- **[DECISION]** Publisher-shared collections retain source attribution (§4).
  Does resharing by an external publisher create a fresh disclosure
  obligation, and who bears it?
- **[DECISION]** Paid placements must be visibly labelled and kept in
  separate contracts/ledgers from affiliate earnings (§3). Is our planned
  ledger separation sufficient, or are further structural separations needed?

## 4. Celebrity image and media rights in affiliate editorial

- **[DECISION]** Owning footage (or a license to it) does not prove
  endorsement or unrestricted advertising rights (§7). What rights assessment
  is required before a celebrity image appears in a shoppable look — and does
  a "similar style" (non-exact) product pairing change the analysis vs an
  exact-item match?
- **[DECISION]** What licence metadata must be stored per asset (footage
  licence, commercial reuse rights, talent restrictions, territory, expiry)
  to evidence our position?
- **[DECISION]** Takedown workflow: on a rights-holder objection, what is the
  required removal timeline, and what propagation is needed (affected looks,
  publisher kits, cached pages)? What records must we keep of the takedown?
- **[DECISION]** Does repurposing paparazzi-style footage into shoppable
  editorial change its fair-use/editorial characterisation in a way we should
  account for contractually with content suppliers?

## 5. Publisher contracts

- **[DECISION]** Please review/approve terms covering: traffic rules
  (prohibited: cookie stuffing, forced redirects, fabricated activity,
  unauthorised subdelegation); validation and holds; clawbacks and negative
  carryover after paid-commission reversals; dispute windows and evidence
  standards; payment timing and thresholds (§9, §14).
- **[DECISION]** Suspension must stop new activity and send existing
  liabilities to review rather than deleting earned balances (§5). Is our
  planned treatment enforceable as drafted?
- **[DECISION]** "A user screenshot alone must not create a payable sale"
  (§5). Is our missing-commission dispute standard (evidence required, no
  ledger effect from screenshots) contractually sound?
- **[DECISION]** Tax information collection from publishers (including
  withholding obligations for the operating entity's jurisdiction) — what
  must the onboarding flow collect and verify?

## 6. Merchant contracts

- **[DECISION]** Please review/approve terms covering: event definitions
  (sale, return, cancellation, lead/install if any), eligible sale value,
  commission basis and rates, reporting and reconciliation duties, settlement
  schedule and payout basis, subpublisher permission where our model requires
  it (§6, §14).
- **[DECISION]** Where a merchant programme forbids intermediary redirects,
  we deliver their compliant link and state reduced attribution openly (§8).
  Any contractual risk in the "reduced capability" disclosure itself?

## 7. Revenue presentation, principal vs agent, tax

- **[DECISION]** Principal-vs-agent determination for the operating entity
  under the managed-subpublisher model (we receive merchant commission, share
  with publishers) vs the publisher-owned-account model (service charges
  only) — and the resulting statutory revenue presentation (§9).
- **[DECISION]** Tax mappings: GST treatment of commissions and service
  charges, withholding on publisher payouts, invoicing requirements. The
  brief requires these be configurable, not hardcoded (§9) — please confirm
  the configuration surface covers what the entity will need at launch.
- **[DECISION]** "No publisher advance before merchant collection" is the
  default commercial policy (§9). Any regulatory constraint on holding
  publisher funds between collection and payout (e.g. e-money / PPI
  characterisation)?

## 8. Data, hosting, cross-border

- **[DECISION]** Hosting jurisdiction for production data (entity still to be
  chosen). Any data-localisation or transfer-restriction implications for our
  stack (Postgres, Redis, queues, object storage/CDN) and for analytics
  tooling?
- **[DECISION]** iOS: ATT and Apple's tracking definition, including
  third-party SDKs (§14, S4). What is our disclosure/consent posture for the
  future native apps?
- **[DECISION]** Incident notification: what are our breach-notification
  obligations, timelines and recipients under the provisions in force at
  launch? (Operational runbook exists: `docs/runbooks/data-incident.md`.)
- **[DECISION]** Hashed client addresses (added 2026-09-29). Each click row
  keeps `ip_hash` = HMAC-SHA256 of the visitor's IP address under a secret
  key (`IP_HASH_KEY`; without the key it is a plain SHA-256, which for IPv4
  can be reversed by trying every address), alongside the user-agent string.
  The value is stable per address so that per-address fraud checks work. Is
  it personal data; who may hold the key; may the key ever rotate; how long
  may the hashes be kept; may any server log carry client addresses (today
  none does by default)? This is a description of the implementation for
  counsel to assess, not a compliance position (`docs/threat-model.md` §4.11).
- Hosting fact (2026-09-29): the owner has chosen a Linode (Akamai) server
  for the pilot; the region is not confirmed in this repository (the owner's
  other sites use Mumbai, ap-west).

---

## Sign-off checklist → go-live gates (§15)

Counsel sign-off is required on each line before monetised rollout. A
critical unresolved item blocks launch.

| # | Counsel sign-off item | Maps to go-live gate |
| --- | --- | --- |
| 1 | DPDP commencement map; notices, consent records, grievance, retention built | Engineering signs off privacy; product signs off workflows |
| 2 | Minors policy approved before public sign-up | Product signs off workflows |
| 3 | ASCI disclosure wording and placement per format; sign-off process defined | Editorial signs off rights and disclosure |
| 4 | Celebrity image rights assessment process; takedown workflow and timelines | Editorial signs off rights and disclosure |
| 5 | Publisher contract approved (traffic rules, validation, holds, clawbacks, disputes, payment timing, tax) | Finance signs off reconciliation and payout controls |
| 6 | Merchant contract template approved (events, eligible value, commissions, settlement, subpublisher permission) | Partnerships signs off merchant and publisher permissions |
| 7 | Principal-vs-agent determination and revenue presentation approved | Finance signs off reconciliation and payout controls |
| 8 | Tax mappings (GST, withholding, invoicing) confirmed for the operating entity | Finance signs off reconciliation and payout controls |
| 9 | No-advance-before-collection policy cleared; publisher-funds holding characterised | Finance signs off reconciliation and payout controls |
| 10 | Hosting jurisdiction and cross-border position confirmed | Engineering signs off security and reliability |
| 11 | Breach-notification obligations mapped to the incident runbook | Engineering signs off security and reliability |

*Recheck programme terms at onboarding and before each material release
(§18). Counsel should treat this briefing as a living list: unresolved
choices become named tickets with owners and due dates (§17), not developer
assumptions.*
