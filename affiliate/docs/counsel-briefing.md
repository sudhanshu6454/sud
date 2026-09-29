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
  for the pilot (172.105.52.150); its region is not confirmed in this
  repository (the recommendation is Mumbai, ap-west).

---

## 9. Amazon.in Associates (added 2026-09-29)

Facts, not conclusions. The owner asked to join Amazon.in Associates with the
in-house network (322 Facebook pages, 82 Instagram accounts, afflino.com, all
the owner's own). Built so far (TEST values only; nothing on the live site
until the owner runs `docs/runbooks/deploy.md` §1A): links
`afflino.com/r/<token>` that 302 to `https://www.amazon.in/dp/<ASIN>?tag=<the
page's tracking ID>` with no cookie and never a per-click id, for the owner's
own Facebook pages, Instagram accounts and afflino.com only (no setting
allows third parties; Snapchat, Telegram and WhatsApp never get one);
Amazon's own statement near every Amazon button and in the footer; no price
unless Amazon's product API supplied it within the last hour, then with its
time and Amazon's disclaimer; Amazon's earnings download imported into the
ledger, attributed by tracking ID. The owner's steps to post links and to
switch the shop on refuse to run until the privacy notice below is
published. Quotes are from Amazon's pages as the policy
brief of 2026-09-29 records them (OA = Operating Agreement, "Updated:
November, 2021", contracting party Amazon Seller Services Private Ltd; PR =
Participation Requirements; LR = Linking Requirements; COU = amazon.in
Conditions of Use).

- **[DECISION]** The redirect. OA §7 defines a "Redirecting Link" ("a link that
  sends users indirectly to the Amazon Site via an intermediate site or webpage
  and without requiring the user to click on a link or take some other
  affirmative action on that intermediate site") — `/r/` is one. PR 30: "You
  will not cloak, hide, spoof, or otherwise obscure the URL of your site
  containing Special Links (including by use of a redirecting page) such that
  we cannot reasonably determine the site from which a customer clicks
  through". LR: no link shortening "in a manner that makes it unclear that you
  are linking to an Amazon Site". Is a first-party 302 (Referrer-Policy
  `strict-origin-when-cross-origin`, `noindex`, labelled "Buy on Amazon.in")
  acceptable, or should the owner obtain Amazon's written confirmation first
  (recommended in the action tracker)?
- **[DECISION]** Disclosure. OA §10's statement is shown verbatim, first,
  near every Amazon button (an operator's own disclosure can only follow it)
  and in every footer from the owner's `setup` step on; the owner adds it to
  every page's bio. Posts start with a link-level label, drafted as
  `#ad · Buy on Amazon.in` (Amazon's examples: "(paid link)", "#ad",
  "#CommissionsEarned"). A look made of Amazon products shows "Affiliate
  links: Yes (we earn from qualifying purchases)" where other looks show
  "Sponsored: Yes / No" — "Sponsored: No" beside commissioned links could
  read as "no paid relationship". What wording and placement satisfy the ASCI
  influencer guidelines for these posts, the look fact and the shop (the
  shop's own line, "We may earn a commission when you shop via these links,
  at no extra cost to you.", sits beside it)? Is an English-only statement
  enough for Hindi posts (no Hindi text found on Amazon's pages)?
- **[DECISION]** Trademarks. PR 2: no Amazon mark "except solely as expressly
  permitted"; the amazon.in Trademark Guidelines page renders empty
  (re-fetched 2026-09-29). Is the nominative use of "Amazon.in" acceptable in
  each public string (every one is a draft kept in one constant, so an
  answer changes it in one place)? The shop's "Buy on Amazon.in", "See price
  on Amazon.in", "Amazon.in Price" (Amazon's own OA §11 example) and "You
  complete the purchase on Amazon.in; Amazon.in's terms apply."
  (`packages/web/lib/site-copy.ts` `AMAZON_IN`); the merchant name
  "Amazon.in", shown as "at Amazon.in" and "Merchant: Amazon.in", and the
  programme name "Amazon.in Associates"; the page link cards show under
  every post (the redirect's preview page: "Afflino link to Amazon.in", "A
  link to a product on Amazon.in", "Open this link in a browser to continue
  to Amazon.in. Afflino earns from qualifying purchases made through it.",
  `AMAZON_PREVIEW_PAGE`); the posts' `#ad · Buy on Amazon.in`
  (`AMAZON_POST_LABEL`, both `packages/shared/src/amazon.ts`); and Amazon's
  price disclaimer with "Amazon.in" filled in. OA §2(f) bars Amazon marks "in
  any … username, group name, or other identifier on any social networking
  site": the owner checks the 404 page names; tracking IDs are refused with
  "amazon", "kindle", "alexa", "echo", "prime", "audible", "fire tv", "imdb",
  "zappos" or "whole foods" in them (OA §7's list is non-exhaustive).
- **[DECISION]** Third parties. PR 9 (links with the tag only on "your site"),
  OA §16 ("deemed to have taken the action yourself") and OA §11 (no tag
  "assigned to anyone other than you"; no Product Advertising Content on a
  platform that requires sublicensing it). Built: Amazon links for the owner's
  own properties only. Confirm that nothing lets Afflino offer Amazon to
  third-party creators under the owner's account, and whether the owner's
  "owner operated" pages (run by the owner, possibly by staff or agencies)
  count as "your site".
- **[DECISION]** Prices, images and the shop's purpose. Two of Amazon's texts
  differ on how long a price may be shown: OA §11 lets non-image content be
  stored "for caching purposes for up to 24 hours" (with a time stamp when
  refreshed less often than hourly), while the Creators API's
  best-programming-practices table — part of the Specifications OA §11 also
  binds the Associate to — says "Offers | 1 hour". Built: the stricter one
  hour (with the time stamp and disclaimer); is 24 hours allowed? Images may
  not be stored; content may not be altered; the product API may not be used
  with a site "that does not have the principal purpose of advertising and
  marketing the Amazon Site". Does a multi-merchant afflino.com meet that
  test? Recommended and built: no prices and no Amazon images in social
  posts.
- **[DECISION]** Amazon's operations. The item page used to say "Payment,
  delivery and returns are handled by Amazon.in", which is wrong for
  third-party sellers' listings (LR: no "inaccurate, overbroad, deceptive or
  otherwise misleading claims about any Product, the Amazon Site, or any of
  our policies"); it now says "You complete the purchase on Amazon.in;
  Amazon.in's terms apply." (draft). Acceptable?
- **[DECISION]** Privacy notice (blocks going live). OA §5 requires
  disclosing "how you collect, use, store, and disclose data collected from
  visitors, including … that third parties (including us and other
  advertisers) may … place or recognize cookies on visitors’ browsers". The
  redirect sets no cookie of its own but stores, per click, a keyed hash of
  the address and the user agent; the privacy page is a stub, and the owner's
  `links` and `shop` steps refuse to run until it is replaced. What text, and
  where?
- **[DECISION]** Bots. PR 27 bars creating Sessions "by way of a robot or
  software program"; PR 25 bars pages opened "other than as a result of the
  customer clicking". Link-preview crawlers (Facebook's, WhatsApp's, search
  engines'), any user agent with a generic bot / crawler / spider / preview /
  headless token, HTTP libraries and command-line clients, requests without a
  user agent, prefetch / prerender requests and HEAD receive a preview page
  instead of the redirect (a heuristic list); is that the right approach?
- Recorded, no question: sub-tags. LR: "Under no circumstances may you
  associate any sub-tag with a specific end user of your site"; the build
  never puts a click id on an Amazon URL and has no setting to do so.
- **[DECISION]** Mobile and messaging. PR 7 bars Special Links "on or in
  connection with any site or application designed or intended for use with a
  mobile phone", while Amazon's own help describes mobile websites — legacy
  text? WhatsApp and Telegram are not in Amazon's accepted social networks and
  not addressed; no Amazon link is posted there until counsel says otherwise.
- **[DECISION]** Tax. OA §8: the fee "is inclusive of all taxes including …
  goods and services tax" and "subject to income tax withholding"; help:
  "Amazon does not expect you to provide an invoice". GST and TDS treatment of
  the fee for the owner's entity (with the accountant; §7 above)?
- **[DECISION]** Report automation. The import is manual (the owner downloads
  the report). COU forbids "any use of data mining, robots, or similar data
  gathering and extraction tools". Confirm manual stays the rule.
- Recorded, no question: OA §20 (Amazon's non-public information not disclosed
  to third parties): report data stays with the operator; nothing shows it to
  creators. Excluded products and 0 % categories are Amazon's (FEES, Aug 2026);
  the system records Amazon's reported fee as is and never recomputes it.

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
| 12 | Amazon.in Associates (§9): the redirect, disclosure wording (posts, the look fact), every "Amazon.in" string, third parties, prices / images and the 1-hour vs 24-hour window, the purchase note, the privacy text (blocks going live), bots, mobile / messaging, tax, manual reports | Partnerships signs off merchant and publisher permissions |

*Recheck programme terms at onboarding and before each material release
(§18). Counsel should treat this briefing as a living list: unresolved
choices become named tickets with owners and due dates (§17), not developer
assumptions.*
