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
  *The owner's answer on the footage (2026-09-30):* "all clips are owned by
  us"; "all footages captured in public place of any celebrity they dont own
  the rights we own it". It is recorded as the owner's dated ownership
  statement (the legal owner's name and who shot the clips: own employees
  only, or employees and freelancers or agencies working for it), and every
  library clip without a licence of its own carries it: commercial reuse,
  worldwide, no end, the statement as the chain of title
  (`packages/api/src/looks/ownership.ts`; withdrawing it hides every image
  it licensed at once). That settles who owns the copyright **in the
  owner's own account only**; still open for counsel: (a) whether the
  statement is enough evidence, or signed assignments must be on file for
  freelance and agency footage (Copyright Act ss.17–19); (b) the talent
  restrictions, which owning the footage does not answer — the first
  [DECISION] above and §10 Q2 (the Delhi and Bombay High Court
  personality-rights orders restrain commercial use of a celebrity's name
  or likeness without consent; in the hearing of 28 Sep 2026 the argument
  was put that a copyright owner may still not be entitled to use the
  footage commercially, not yet ruled on); (c) the editorial
  characterisation of shoppable use (the last [DECISION] of this section).
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

## 10. Celebrity looks: outfit pieces, rights controls, takedowns, comment replies (added 2026-09-30)

Facts, not conclusions. The owner's direction: Afflino's consumer side is
built around celebrity looks from the owner's paparazzi video library (each a
paparazzi moment: a celebrity, an event or place, a date, the source video
and a still, the in-house page and post that published it), with the outfit
tagged piece by piece — the product the celebrity wore (EXACT) or similar
styles (SIMILAR) — plus creator features (a storefront per in-house page,
the look page per post, a keyword comment answered with one private
message carrying the look page's afflino.com URL, instant links, click
analytics). The research brief of 2026-09-30 ("CELEBRITY-LOOK COMMERCE:
LEGAL AND PLATFORM CONSTRAINTS BRIEF", quotes checked against the
judgments and statutes it names) records that the law is moving (the Delhi
High Court began hearing three personality-rights suits together on
30 Sep 2026; on 28 Sep it asked whether a photographer's own use of the
copyright in a celebrity photo still violates personality rights — no ruling
yet). Nothing below says any of it is lawful.

**What is built (the backend, TEST data only; nothing is on afflino.com):**
- Every celebrity has a rights status — `unreviewed` (the default),
  `editorial`, `cleared`, `blocked` — that only the rights reviewer role
  (counsel's) sets beyond `blocked`, with an evidence reference and a note,
  in an append-only history. One table (`CELEBRITY_RIGHTS_MATRIX`,
  packages/shared/src/celebrity.ts) says what each status allows at most:
  unreviewed / blocked nothing; editorial the name only, no products;
  cleared name, image and products. Each review then records what counsel
  allowed for that person (name only / name and image; products or not),
  defaulting to the narrow end. **These defaults are ours, pending counsel.**
- Minors and a never-list: a celebrity flagged a minor (or never-listed)
  can never leave unreviewed / blocked (a database CHECK); stills flagged
  with a minor in frame, bystanders, a sensitive location (hospital, home,
  school, place of worship) or a live performance are never shown (a flag
  once set cannot be cleared by a later file or an editor); place text
  naming such places is refused (an English word list: medical places,
  residences incl. buildings, towers, societies and villas, schools and
  classes, places of worship); a look whose place kind is `street` or
  `other` is published only after the rights reviewer confirms the place
  (no word list can catch a named residence; Q27); a look is published
  only after the day of the moment (never live whereabouts).
- Assets carry licence metadata (licence, commercial reuse, territory,
  expiry, source, copyright owner, author, acquisition and assignment
  reference) and an editor's frame screen (no voyeuristic or body-zoom
  framing). An image is shown only while the licence allows commercial
  reuse in India, has not expired, the chain of title is complete (a
  copyright owner, the acquisition, and for anything but staff work an
  assignment reference — the build checks that a reference is recorded,
  not what the document says), the screen passed and the celebrity's
  status allows images — at every read (feed, hub, look page, storefront,
  sitemap), so an expiry or a downgrade hides it at once. Widening a
  licence fact (commercial reuse, territory, expiry, the chain of title)
  needs the rights reviewer and is audited; a new image address resets the
  frame screen. The still is served at Afflino's own address
  (`/img/looks/<id>`), fetched from the origin file on each request that
  passes every rule; the origin address is never given to the public, so a
  takedown or an expiry answers 410 / 404 there too (copies others already
  downloaded or cached are outside Afflino's control).
- EXACT needs evidence (what it shows and its source) and a second person's
  approval; at most one per piece; its tracked link is made only after that
  approval. SIMILAR says "Similar style. {name} did not wear or endorse this
  product."
- Where a name may appear: a celebrity's name appears on a page only in the
  credit line of that person's own look (and their hub), in one sentence
  with the non-endorsement line "{name} is not affiliated with Afflino and
  has not endorsed any product on this page.", at body size. The text the
  editors, the operators and the library write — a look's event, place and
  piece labels, a product's brand, model and category, a storefront's name,
  slug and bio, an Amazon shelf's title — may name nobody: it is checked
  against every celebrity's name and aliases (also glued, hyphenated or
  written as a handle) when written (refused), and again at every read, so
  a celebrity or alias added later hides the text written before it (the
  look 404s, the product is left out, the storefront 404s). The same texts
  may not use endorsement wording ("worn by", "her pick", "dupe", "for
  less", "inspired", "replica", "first copy", "7A", "lookalike", "as seen",
  "steal the look", "<word> style", "<someone>'s bag", "rocked", savings
  claims; English only, a Hindi list is open, Q11). This is a word list:
  it catches the phrasings it lists, not every way of implying a link.
- The headline is composed from the event or place the editors typed —
  "Spotted at <event>", "Spotted in <place>", or "Spotted" — and never
  carries the name. A look page with products starts with a commercial
  label; a look without products (name only, or products not allowed)
  carries none and says "Affiliate links: No products on this page". Amazon
  is never named with a celebrity in the look's own text; no Amazon content
  is composited onto stills (the API returns the still and the products as
  separate blocks).
- Takedowns: one call (per celebrity or per look) withdraws every affected
  page at once (HTTP 410 for a page that was public; content that never was
  stays 404), pauses its tracked links (the redirect serves a paused page),
  turns its comment replies off, clears the caches (the public API's own
  answers at once; a web process's up to 5 s), records when the notice was
  received, acted on and completed, and lists the in-house posts the owner
  must delete on Meta by hand, the addresses to refresh in Meta's Sharing
  Debugger (link previews already shared) and the stills by their library
  reference. A celebrity takedown also withdraws other looks whose text
  names that person. A restore needs the rights reviewer and a new review
  recorded after the takedown; links come back only for looks that are
  public and allowed products.
- Comment replies send one private reply per comment carrying only the look
  page's afflino.com URL (never a /r/ link or a merchant URL: tested), with
  an "Ad" label, an automated-message line and "Reply STOP", only while the
  look is public and carries products; the optional public answer under the
  comment is one of three fixed texts ("We sent you a message with the
  link." and two like it: no link, name or product); a STOP comment or a
  STOP sent in reply to the message opts out; opt-outs are kept as keyed
  hashes; no comment text, username or raw id is stored; events are deleted
  after 30 days (placeholder); Meta's data deletion callback deletes a
  person's events (the opt-out stays). Off by default; refused while
  /privacy is the stub page.
- Real celebrity names and library data never enter the repository; the
  fixtures are fictional ("Demo Star One"), refused under production.

**What the web shows (stage 2, 2026-09-30; TEST data only; screenshots at
desktop and phone width can be sent with this brief):**
- `/shop` is the "Spotted" feed (newest first; filters by celebrity and by
  in-house page; a "Trending this week" row ranked by the last 7 days'
  clicks, no counts shown); `/c/<name>` a celebrity's page; `/looks/<id>`
  the look; `/s/<page>` a storefront per in-house page (its bio link, with
  share and a QR code). Only what the rights review allows reaches any of
  them: an unreviewed, blocked or withdrawn celebrity has no page (404; 410
  once a page that was public is withdrawn) and appears in no list, and no
  other text on these pages names them (above: checked when written and at
  every read).
- The look page, top to bottom: the commercial label ("Ad · This page has
  affiliate links", draft; only when the look has products); the headline
  ("Spotted at <event>", 28 px, 24 px on phones; never the name); the name
  with the non-endorsement line in the same paragraph, in body type (15 px,
  full ink, not faded);
  the still (grayscale) with small numbered markers on garments only — no
  marker on eyewear, headwear or jewellery, so nothing sits on a face, and
  no text on the image; beside it "About this moment" (the event, the
  place, the date, the number of pieces, "Affiliate links: Yes (we earn
  from qualifying purchases)") and "View the original post" (the owner's
  Facebook / Instagram post); then the outfit piece by piece: the "Exact match" product first
  (only after the second person's approval), then "Similar style" products,
  each with "Similar style. {name} did not wear or endorse this product."
  Every feed card and the hub repeat the name with the non-endorsement line
  (14 px on cards, under a name-free 22 px headline; the hub's heading is
  "Spotted looks", the name in the line under it). The browser tab and the
  link preview's title of a hub carry the name (the page's title), with the
  non-endorsement line as the preview's description (Q26).
- Every product: "Buy on Amazon.in" through Afflino's `/r/` link only (no
  raw Amazon URL on any page), "See price on Amazon.in" unless the product
  API's price is fresh (then with its "as of" time and Amazon's disclaimer),
  and Amazon's Associate statement beside every button.
- Link previews (Facebook, WhatsApp, X) show Afflino's icon, never the
  still, and the non-endorsement line as the description.
- Search engines: every celebrity page (and `/shop` while it shows a look)
  is `noindex` and out of the sitemap until the owner sets
  `CELEBRITY_INDEXING=on` — off by default, pending your answer (Q25).

**Questions (the brief's Q1–Q20; Q21–Q26 added with the web pages; Q27–Q29
after the reviews of 2026-09-30; Q30 with the owner's ownership statement):**
- **[DECISION]** Q1. Is a shoppable celebrity look page with affiliate
  commission "news … and other similar uses" (Digital Collectibles v.
  Galactus Funware, Delhi HC 2023, para 57) or commercial exploitation
  (para 55; Anil Kapoor 2023 para 48; Aishwarya Rai Bachchan 2025 para 39)?
  What written consent or licence makes it permissible (the only route to
  `cleared` with products we assume)?
- **[DECISION]** Q2. Does owning the copyright in the footage give any right
  to use the celebrity's image commercially (the 28 Sep 2026 Delhi HC
  exchange)?
- **[DECISION]** Q3. Passing-off with confusion (Digital Collectibles para 55)
  or no proof of confusion needed (Titan v. Ramkumar Jewellers 2012)? How
  does the answer change SIMILAR versus EXACT?
- **[DECISION]** Q4. Does name only versus name and image matter, and is a
  name alone (text) still restricted when paired with products? (The matrix
  default lets `editorial` show a name without products.)
- **[DECISION]** Q5. What evidence suffices for a status per celebrity; should
  it be per territory (the build shows images for India only)?
- **[DECISION]** Q6. Minors: is the zero-minors rule enough, including a child
  appearing incidentally in a parent's frame (the build excludes the still)?
- **[DECISION]** Q7. Does a celebrity still beside products make the page an
  "endorsement" (Consumer Protection Act 2019 s.2(18)(ii))? Does CCPA 2022
  cl.13 rule out SIMILAR pairings with the image altogether?
- **[DECISION]** Q8. What evidence substantiates an EXACT claim (cl.12(a);
  s.2(47)(i)(a)), and for a third-party seller's listing that may not be the
  genuine item?
- **[DECISION]** Q9. May the editorial name the brand the celebrity wore next
  to cheaper SIMILAR alternatives (Trade Marks Act s.29(8); ASCI Chapter IV)?
  The build never names the original's brand on SIMILAR items.
- **[DECISION]** Q10. Is an editorial-style look page a "disguised
  advertisement" (Dark Patterns Guidelines 2023)? Which top-of-page label
  avoids that (the draft: "Ad · This page has affiliate links")?
- **[DECISION]** Q11. Approve the non-endorsement line and the SIMILAR / EXACT
  wording in English and Hindi, as statements that do not "correct" a
  misleading claim (CCPA cl.11).
- **[DECISION]** Q12. Are the owner's pages "handles of media companies" (ASCI
  Chapter I, 10 Jul 2025), and which label list applies ("Affiliate" is not
  on that list; "Ad" is on both)?
- **[DECISION]** Q13. Performers' rights in footage of live performances
  (Copyright Act s.38): excluded by default here — cleared how?
- **[DECISION]** Q14. Does DPDP s.3(c)(ii) cover a celebrity filmed in public,
  and bystanders? With no journalism exemption, which lawful basis and notice
  apply? The same for commenters (keyed hashes only).
- **[DECISION]** Q15. The DPDP timeline: was the 12-month acceleration
  notified?
- **[DECISION]** Q16. Is Afflino (or the owner's pages) a publisher of "news
  and current affairs content" (IT Rules), and what follows while Rule 9 is
  stayed?
- **[DECISION]** Q17. Does the intermediary safe harbour (IT Act s.79) apply to
  any part of Afflino, and which takedown timelines and records should
  Afflino commit to (the build records received / actioned / completed and
  marks more than 60 min "warn", more than 180 min "breach")?
- **[DECISION]** Q18. Amazon PR 11 ("including by placing unrelated third
  party materials in close proximity to Content"): may EXACT or SIMILAR
  Amazon links appear on a page with a celebrity still at all? Should
  Amazon's written confirmation be sought (owner action)?
- **[DECISION]** Q19. Meta: are affiliate-commission posts "branded content"
  needing the tool and Amazon's "prior permission"? What does "Creators
  cannot accept anything of value to post content that does not feature
  themselves or that they were not involved in creating" mean for the
  owner's pages?
- **[DECISION]** Q20. Is a keyword-triggered private reply with a look URL a
  "third-party ad … in messages" (Meta Developer Policies §10)? Is a comment
  with the keyword, on a post that offers the message, sufficient opt-in?
- **[DECISION]** Q21. The non-endorsement line on the web: is its placement
  (in the same paragraph as the name, under the headline; on every card; on
  the hub) and its size (body type, 15 px on pages, 14 px on cards, full
  ink) prominent enough, or must it sit above the products or beside each
  one as well? The headlines are larger (28 px on pages, 24 px on phones,
  22 px on cards) but never carry the name (built after the review of
  2026-09-30, CCPA cl.11's "same type size" point): the name is only in the
  body-size line. Is a name-free display headline over a body-size credit
  line acceptable, and must the page's title (the browser tab, a hub's link
  preview), which carries the name, carry the line too?
- **[DECISION]** Q22. The page labels (drafts): "Spotted" (the feed's name),
  "Exact match", "Similar style", "Trending this week", "View the original
  post", "Posted on", "This page was withdrawn." — approve or replace, in
  English and Hindi.
- **[DECISION]** Q23. Storefronts (`/s/<page>`): the build treats a storefront
  as a celebrity page for every rule (each look on it passes the read gate;
  the labels; noindex) and its own name, slug and bio may name nobody (a
  storefront named after a celebrity — common for fan pages — cannot go
  live, and 404s once a later name matches). Is that right, and may a
  storefront's bio link sit in the page's bio on Instagram / Facebook with
  no label beyond the page itself?
- **[DECISION]** Q24. The "Trending this week" row ranks looks by clicks
  without showing numbers. Is a popularity ranking of looks naming
  celebrities a claim that needs substantiation or a label?
- **[DECISION]** Q25. May celebrity pages be indexed by search engines (the
  name in page titles and search snippets), and if so from when
  (`CELEBRITY_INDEXING`)?
- **[DECISION]** Q26. Link previews: is the non-endorsement line as the
  preview description, with Afflino's icon instead of the still, the right
  treatment for a shared look?
- **[DECISION]** Q27. Places: the build publishes a look whose place kind is
  an event, a venue, an airport or a studio without a person confirming
  the place; a street or "other" place needs the rights reviewer's
  confirmation. Is that list right, and what makes a street place
  acceptable (a public thoroughfare only, never outside a residence)?
- **[DECISION]** Q28. The public comment answer: three fixed texts ("We sent
  you a message with the link.", "Check your messages: the link is there.",
  "Sent. The link is in your messages."), posted under the comment on the
  owner's page. Approve them (and in Hindi)?
- **[DECISION]** Q29. Analytics: clicks by look, piece, page and storefront
  (`?via=` kept in the click's context, no cookie; the admin shows counts to
  the network admin and editors only). Anything to add to the privacy
  notice?
- **[DECISION]** Q30. The owner's ownership statement (2026-09-30; §4): the
  owner states the organisation owns every library clip, shot in public
  places, and the library import records that dated statement as the
  licence of every clip without one of its own (commercial reuse,
  worldwide, no end). Is the statement enough to stand behind the
  footage's copyright, or must signed assignments (freelancers) and
  licences (agencies) be on file before an image is shown? It says nothing
  about the people filmed: each celebrity still waits for your review.
- **[DECISION]** Retention: how long may the reply events (keyed hashes, the
  keyword, the status; 30 days now), the opt-out list (kept), the
  evidence behind EXACT tags (kept while the look exists) and the
  celebrity data (names, aliases, looks, stills' references, reviews,
  takedown records; nothing is deleted automatically now) be kept?

**Open gaps the build does not close (2026-09-30):** the name and wording
checks are word lists (English; a Hindi list and wording that implies a
link without the listed phrases are open); the chain of title is checked
for presence, not validity; a place is coarse text an editor writes (the
street / other confirmation is a person's judgement); a still's origin
file is removed by the owner, not by Afflino, and copies others made are
out of reach; the web's 410 lags a takedown by up to 5 s per web process;
nothing alerts on Meta's policy warnings yet; roles are on the sign-in
stub, as forgeable as every other role until a real identity provider
exists.

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
