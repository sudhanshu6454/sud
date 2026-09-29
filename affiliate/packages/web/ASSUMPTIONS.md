# Assumptions — @paparazzi/web

1. **CSS Modules over tailwind.** Styling is dependency-free: CSS Modules only, no tailwind or UI libraries, per the build brief. The workspace uses pnpm strictly; no new deps were installed (`pnpm install` was explicitly forbidden).
2. **Mock data, no API wiring.** All content comes from `lib/mock-data.ts` (3 looks, 6 products; prices in paise). Phase 2 will swap this for the real catalogue/attribution APIs from `packages/api`. The home-page search filters the mock list client-side; the empty state (“No looks match — try clearing filters”) is reachable by typing a non-matching query.
3. **No API wiring.** No fetch calls exist anywhere. Outbound merchant CTAs are `href="#"` stubs documented in code comments; they become signed redirect-service URLs (click id, attribution, sponsor flags) in phase 2.
4. **`icon.svg` is an original placeholder.** Tiny hand-drawn camera glyph; not a brand asset. Replace with the real product icon before launch.
5. **Locale toggle is visual-only.** The EN/हिं switch in the header is a documented stub; no i18n framework, dictionaries, or routing by locale yet.
6. **PWA is manifest + meta only.** Manifest, appleWebApp meta, theme color and icon are in place; the service worker is intentionally omitted until the offline/caching strategy is decided.
7. **No `next/font/*`.** System font stack only, to avoid network fetches during build.
8. **Freshness timestamps are build-time.** Mock `freshness` ISO values are generated relative to build time; `timeAgo()` labels are computed at render, so static pages show build-time labels until revalidation is introduced in phase 2.
9. **Wishlist is local-only.** `saved-products` in localStorage; no auth, no cross-device sync.
## Portal + console (2026-09-22)

11. **Typed v1 client in `lib/api.ts`.** Base URL from `NEXT_PUBLIC_API_BASE`
    (default `http://localhost:3000`); `Authorization: Bearer` from localStorage
    `paparazzi_token`. Success envelope `{data, request_id}` is unwrapped;
    failures throw `ApiError` with the wire `error.code`. `withDemoFallback`
    returns `{value, demo}` so pages can render `<DemoBadge />` whenever the
    fallback is active ("demo data — API unreachable"). Pages built only against
    the documented v1 surface (`GET /v1/publisher/earnings`,
    `POST /v1/links`); no dependency on endpoints being built in parallel.
    *Superseded in part by 64: `withDemoFallback` now returns the error, and
    only an unreachable API is labelled "API unreachable".*
12. **Portal dashboard** (`/portal`): stat cards for clicks, matched
    transactions, paid (no v1 endpoint yet — always demo, labelled), and
    pending/approved/collected/payable from the earnings API with demo fallback.
    Publisher id from localStorage `paparazzi_publisher_id`, else the demo
    constant in `lib/api.ts` (*superseded by 64: the demo id is never sent*). Recent conversions table is mocked and labelled
    (no v1 endpoint).
13. **Link builder** (`/portal/links`): demo option lists (no listing endpoint
    in v1). POSTs to `/v1/links`; API error codes map to human messages
    (`PROGRAMME_NOT_APPROVED` → "programme not active", `OFFER_STALE` →
    "offer expired", `PROPERTY_FORBIDDEN` → "property not found or not approved
    for your organisation"; *the option lists are superseded by 67*). On network
    failure a demo `/r/{token}` URL is minted locally with a clear "not
    tracked" warning — it earns nothing.
14. **Statements** (`/portal/statements`): programme → property → placement
    drilldown over demo ledger entries with running balance and currency
    totals; demo dispute history with the note that a screenshot alone does not
    create a payable sale. No ledger endpoint in v1 yet.
15. **Editorial console** (`/console`): six-column pipeline board, client-side
    state in localStorage `paparazzi_console_looks` (seeded with demo looks).
    Gate checklists per transition enforced before advancing; Ready→Published
    additionally records URL, post ID, publisher, placement, creative version.
    Pause/withdraw requires a reason and remembers the resume state. No review
    API exists in v1, so all moves are local.
16. **Match review** (`/console/looks/[id]`): exact/similar verdicts per
    candidate; "exact" hard-requires non-empty evidence (approve stays disabled
    otherwise); rights checklist (footage licence, commercial reuse, territory,
    expiry) also required; approve → commercial review, reject → draft.
17. **Disputes** (`/portal/disputes`): live list from `GET /v1/disputes` with
    the standard demo fallback (`DEMO_DISPUTES` reshaped onto the v1 type);
    ticket-filing form posts to `POST /v1/disputes` (disabled in demo mode).
    The page states the platform rule: a ticket alone never creates a
    payable sale — resolution requires provider-side verification.

## Live consumer shop (2026-09-29)

18. **Server-only catalogue client.** `lib/catalogue.ts` and
    `lib/server-env.ts` read `WEB_API_TOKEN` / `WEB_PLACEMENT_ID` /
    `API_BASE` from the server's environment. The `server-only` package is
    not installed, so the guard is by convention: these modules are imported
    only from server components, `generateMetadata` and the `/api` route
    handler, never from a `'use client'` file. The token is a read-only role
    (`publisher_analyst`); it is never `NEXT_PUBLIC_` and is never attached
    to browser requests that pass through the proxy.
19. **No raw merchant URL, ever.** The API never returns `offers.offer_url`,
    and the view type only carries `linkUrl` (the tracked `/r/{token}` URL)
    or `null`. A missing link renders a visibly disabled "Link not available
    yet" control; a missing live offer renders "Not available right now"
    with no price and no CTA. Links open in the same tab with
    `rel="sponsored nofollow noopener"`.
20. **Revalidate 60.** Every catalogue fetch carries
    `next: { revalidate: 60 }`; pages are `dynamic = 'force-dynamic'` so the
    HTML is never a build-time snapshot, while the API response is reused
    for 60 s. Next's data cache is stale-while-revalidate: the first request
    after the window can still serve the previous body while the entry
    refreshes (observed in the end-to-end check: a freshly minted link
    appeared on the second request after the window, not the first).
21. **`/api` proxy is a route handler, not a `rewrites()` entry.** Next 14
    freezes rewrite destinations into `.next/routes-manifest.json` at build
    time, but `docker-compose.prod.yml` passes `API_BASE` at container
    start (and builds with `NEXT_PUBLIC_API_BASE=/api`). `app/api/[...path]/
    route.ts` resolves `API_BASE` per request instead; the URL shape
    (`/api/:path*` → `${API_BASE}/:path*`) is the one the task specified.
    `lib/api.ts` defaults `API_BASE` to `/api`; an absolute
    `NEXT_PUBLIC_API_BASE` still bypasses the proxy.
22. **Route change.** `/products/[id]` is gone: product ids are `look_items`
    ids and resolve only through `GET /v1/looks/:id`, so the product page is
    `/looks/[id]/items/[itemId]`. The wishlist moved from `saved-products`
    (bare ids) to `saved-items` (look id + item id + display data captured at
    save time) so `/saved` can render without calling the API from the
    browser; old entries are ignored rather than migrated (they were mock
    ids). The README no longer lists `/products/[id]`.
23. **Everything renders on demand.** `dynamic = 'force-dynamic'` in the root
    layout (and the manifest) so `NEXT_PUBLIC_SITE_NAME` is read from the
    server's runtime environment for every route — the compose file sets it
    at runtime, not as a build arg. `output: 'standalone'` with
    `outputFileTracingRoot` = monorepo root matches `docker/Dockerfile.web`
    (`node packages/web/server.js`).
24. **Demo data is TEST-labelled.** The mock catalogue's merchants, brands,
    source pages and titles are now all "Demo …" (previously it named real
    marketplaces); demo items have no link. The console's local review board
    keeps its `p1…p6` demo candidates through `getProduct()` in
    `lib/mock-data.ts`. The link builder's offline demo URL uses the
    RFC 2606 host `redirect.demo.invalid`.
25. **Filters.** Category chips are real (derived from the loaded looks'
    `category`, toggle to filter); the former budget chips were removed
    because the list endpoint carries no prices — a visual-only filter on a
    live shop would mislead. Search filters title, source page and category
    client-side over the already-loaded list (the list endpoint has no
    search parameter).
26. **Variant facts instead of a size selector.** The item page shows the
    variant the editors matched (`size_text · colour · merchant_sku`) rather
    than a fake size picker; sizes are chosen at the merchant.
27. **`mint-links.mjs` and its test.** The script (packages/api/scripts) is
    the only file outside this package touched by the shop work; its
    end-to-end test lives in `packages/web/test/mint-links.test.ts` (stub
    API over `node:http`, real script via `child_process`) because the
    script exists for the shop's placement. The script dedupes an offer that
    appears in several looks within one run (`skipped_duplicate_offer`) and
    counts an idempotent replay (`X-Idempotent-Replay: true`) as
    `replayed`. In a container deployment it runs from the api image, which
    ships it (`docker/README.md` "Operator scripts").
28. **Not verified here.** `docker/Dockerfile.web` was not rebuilt in this
    pass (out of this package's ownership); the standalone layout it expects
    (`.next/standalone/packages/web/server.js`) was confirmed to exist after
    `next build`.

## Review fixes (2026-09-29)

- **The `/api` proxy refuses `.` and `..` segments** (400): they survive `encodeURIComponent`
  and URL parsing would collapse them, climbing out of a path-prefixed `API_BASE`. Upstream
  calls time out after 30 s.
- **The proxy makes the API reachable from the public shop host.** That is no wider than
  the API's own public host already is, but it means the API's own auth (the JWT stub) is the
  only gate on both hosts.

## Afflino foundation (2026-09-29)

29. **Rebuilt to the Afflino handover.** Tokens, base rules and component
    classes come from the handover's `styles.css`; values are ported from the
    rendered artboards, which win where the handover README's prose differs:
    table header rule is the 2px *divider* colour (sampled #9f9d9d on the
    mocks), not ink; header text is 11px uppercase 0.08em 600 at 60% ink;
    cells have no horizontal padding; links are ink with an accent-700 hover
    (the reference page overrides styles.css's accent link colour); the
    consent checkbox is the round 16px dot the mock draws.
30. **Archivo is self-hosted** (`app/fonts`, SIL OFL 1.1) through
    `next/font/local`, as two faces (latin, latin-ext) because next/font/local
    cannot give each file its own `unicode-range`; `--font-archivo` joins
    them (ext first so ₹ never falls back to a metric-adjusted local Arial).
    Replaces assumption 7 (system font stack). "→" is in neither subset and
    falls back to the system face, exactly as in the mocks.
31. **Demo proper nouns are renamed** "Demo …" one-for-one (the handover's
    mock names include real companies and plausible real channels); the
    numbers are as designed. The mapping is in `lib/demo/afflino.ts`'s module
    header; `test/format.test.ts` asserts no original name survives.
32. **Claims and prices live in one module**, `lib/site-copy.ts` (400M reach,
    ₹0 upfront, T+7, ₹24,999/month, 15% / 8% fees, TDS 1% under 194-O, 7-day
    validation, ₹500 minimum withdrawal). They came from the handover as
    placeholders; the owner confirmed them on 2026-09-29 (item 78). The creator disclosure line there is a draft
    pending counsel (docs/action-tracker.md, ASCI rows), not a compliant
    disclosure.
33. **Tracking is unchanged.** The design's first-party attribution cookie and
    readable `/r/{handle}/{offer}?s=` links are not implemented; the platform
    redirect stays `/r/{32-hex token}` with no cookies (counsel-gated).
34. **One app, one breakpoint.** The mobile artboards are the phone layout of
    the same PWA: ≤760px the sidebar becomes a top bar (wordmark + 32px account
    box → settings) and a fixed bottom tab bar; the marketing chrome collapses
    its links into a menu below 900px. The sidebar is sticky at 100vh (the
    artboards simply end at their content). The phone top bar is drawn only
    where the artboards draw it: 3f's Offers and Payouts put their title
    straight under the status bar, so `/app/offers` and `/app/payouts` have
    none (`AppShell` `phoneTopbarHiddenOn`, `CREATOR_PHONE_TOPBAR_HIDDEN_ON`);
    the account box stays on Home (1e) and the other creator pages. The
    brand's 3f Today keeps it (it is the brand's only phone entry to
    Settings).
35. **Agency navigation** is Workspace (`/agency`), Brand clients
    (`/agency#clients`), Roster (`/agency#roster`), plus a workspace switcher
    into `/brand?workspace=<client id>`. *Superseded in part by 39.*
36. **Formatting rules** (lib/format.ts): rupees in Indian grouping, counts in
    western grouping (the mocks print 312,880 clicks but ₹1,84,320), compact
    figures truncate to one decimal (312,880 → "312.8K" as drawn), paise only
    where drawn (EPC). The handover's "Fri 3 Oct" payout is a Saturday in
    2026; the demo stores the date (2026-10-03) and a formatter renders the
    weekday from it.
37. **Select shows a chevron** (the mocks draw selects as plain boxes); a
    native select without any affordance reads as a text input.
38. **Dev gallery** `/dev/ui` renders every primitive; it returns 404 when
    `NODE_ENV=production`, so it is only visible on a dev server
    (`NEXT_DIST_DIR=.next-dev next dev`).

## Foundation review fixes (2026-09-29)

39. **Agency ↔ brand workspace.** `/brand?workspace=<client id>` is read by
    `app/brand/BrandShell.tsx`: the shell shows that client as the account
    and a workspace switcher (the agency's other clients, "Back to agency"),
    and every brand nav / tab / logo / settings link carries the parameter
    (`navInWorkspace()` / `withWorkspace()`, `components/shell/areas.ts`;
    nav matching ignores `?query`). An unknown id falls back to the brand's
    own shell. In-page links inside `/brand` must use `withWorkspace()` or
    the agency drops out of the workspace. The agency has no settings screen
    (route map), so its phone account box is shown, not linked
    (`AppShell` `settingsHref` is optional).
40. **Demo accounts are labelled in the shell.** `ShellAccount.demo` renders
    `<DemoBadge variant="mock" />` in the sidebar footer, adds "(demo
    account)" to the phone account box's name, and puts the badge under the
    phone workspace switcher (which prints demo names). All three area
    layouts pass it until sign-in is wired.
41. **The portal / console pages are back** at their new routes (links,
    disputes, statements, suspense, looks pipeline, match review) with the
    HEAD logic unchanged and the chrome replaced by the Afflino primitives;
    they have no artboard. Their demo data (`lib/portal-demo.ts`,
    `lib/console.ts` seed) named real merchants as programmes (Flipkart,
    Myntra, Ajio) and carried unlabelled invented names; every proper noun is
    now "Demo …" and `test/format.test.ts` guards it. Browsers that already
    stored the old console seed (`paparazzi_console_looks`) keep their stored
    titles until that key is cleared. `GET /v1/publisher/earnings` (the old
    `/portal` dashboard) is not wired until the 1c overview is built. One
    behaviour change: link minting treats the proxy's `502
    UPSTREAM_UNAVAILABLE` like `NETWORK_UNREACHABLE` (the labelled, untracked
    `redirect.demo.invalid` demo link); behind the same-origin `/api` proxy
    the HEAD branch could never fire.
42. **No cookie claims in demo copy.** The design's "30-day cookie" / "7-day
    cookie" offer lines are dropped (see 33); screens must not print
    "Cookie 30 days" either.
43. **The demo mobile number is impossible**, `+91 00000 00000` (the design's
    "+91 98450 12345" is a dialable number in a live series); `validateMobile`
    rejects it, and the validator's own error copy carries no example number.
44. **Global disabled rule covers native controls only** (`button`, `input`,
    `select`, `textarea` `:disabled`); components that use `aria-disabled`
    on other elements style it themselves (Button's inert link, the shop's
    "Link not available yet" CTA, which is no longer dimmed a second time).
45. **Field around a group** renders its label as a `<span id>` referenced by
    the group's `aria-labelledby` (auto-detected for a direct Segmented /
    SelectableCardGroup child via their static `fieldGroup` flag, or
    `<Field group>`); a `<label for>` would point at an id nothing carries.

## Afflino screens (2026-09-29)

Every route of the handover is built (README "Screen map"). Items 2, 3, 5, 7
and 9 above describe the pre-Afflino prototype and are superseded (live
catalogue: 18–22; the locale toggle is gone; Archivo: 30; wishlist key
`saved-items`: 22).

**Across the app**

46. **One accepted visual deviation: the demo badge.** Every page that shows
    TEST data renders `<DemoBadge />` — `variant="mock"` where no endpoint
    exists or the API answered with an error, `"fallback"` only when a live
    call could not reach the API (64) — in the page header's
    actions or next to a section label. The badge has no outer margin; the
    placement spaces it. Proper nouns are "Demo …" one-for-one and the
    numbers are as designed; the extra data each area needs lives in
    `lib/demo/<area>.ts` under the same rule (new identifiers include
    `rq-demo-6`…`rq-demo-10`, `ST-DEMO-*`, `winter-sale.example.net`, PAN
    `DEMOX0000Z`, handle `@demo.priyanair`, promo codes `DEMO` + the payout
    figure, landing hosts `*.example.com`). Invented where the design draws
    nothing: the Snapchat account on `/join` (96K · 88% India), the 7d / 90d
    creator figures (built around the designed 30d), the undrawn admin and
    brand pages' figures (made to add up to the drawn totals).
47. **Browser storage** (demo state, per browser, never sent):
    `afflino_demo_creator_settings`, `afflino_demo_applications`,
    `afflino_brand_{offers,requests,conversions,settings}_v1` (split by
    workspace: `own` or the client id), `afflino_agency_{share,invites,clients}_v1`,
    `afflino_admin_review_v1` (shared by every admin page),
    `paparazzi_console_looks`, `saved-items` (+ the
    `afflino:saved-items-change` event, since `lib/saved.ts` has no change
    notification); `/login` writes `paparazzi_token` / `paparazzi_publisher_id`.
48. **Interactions** follow the handover everywhere: primitives' hover /
    pressed / focus-visible states, 120ms colour transitions, skeletons (no
    spinners) and "—" in KPIs until loaded, flush-left empty states with one
    action, inline accent-700 field errors that focus the first invalid
    control on submit, a top Banner for page-level failures, "Copied" for 2s
    announced through a polite live region, dialogs through the Dialog
    primitive, ≥44px targets on phones.
49. **Integration fixes.** The pieces two or more areas needed were
    promoted: `lib/csv.ts` (the three Export CSV implementations were
    identical; the brand's export now also carries the UTF-8 BOM),
    `lib/download.ts`, `lib/clipboard.ts` (onboarding's copy gains the
    execCommand fallback), `lib/earnings.ts`, and `validateIfsc` /
    `validateBankAccount` in `lib/validators.ts` (onboarding and settings keep
    their own empty-field wording). The Dialog body dims its copy with a text
    colour instead of `opacity: 0.85`, so forms inside dialogs are not faded
    (the three local overrides are gone); the Input primitive hides WebKit's
    blue search clear button (three local rules gone); the creator app has
    its own 404 inside the shell; "Log in" carries `aria-current` on
    `/login`; the unused `LegalStub` and `ScreenPlaceholder` were removed.
50. **Creator earnings, one mapping** (`lib/earnings.ts`). Overview (1c)
    "Next payout" and Payouts (2c) "Available to withdraw" are the same
    figure, max(`collected` − `payable`, 0) — what `POST /v1/payout-batches`
    can still put in a batch (it sizes batches as max(min(eligible,
    collected) − batched, 0), and `collected` never exceeds eligible) — as the
    design draws one amount (₹42,900) for both. `approved` (the net
    publisher_liability) is not shown as a payout: it includes earnings the
    merchant has not paid for and earnings inside the returns window.
    Overview "Unpaid earnings" = `pending` + `approved`, earned and not yet
    paid out (meta "₹X pending · ₹Y approved"; a negative `approved`, a
    reversal after payout, reads "₹Y reversed after payout"). It is not
    "to date": every paid batch debits `approved`, so the figure falls after
    a payout, and the route returns no lifetime total (a true to-date figure
    needs `paid_minor` added to the response). Payouts "Pending approval" =
    `pending` ("Awaiting the brand's approval" when live); with live
    balances a line under Available names approved − available ("₹X more
    approved: not yet collected from the brand, still in the returns window,
    or in a batch that is not paid yet"), so the page adds up to the
    Overview. Live amounts print exactly (paise when there are any, never
    rounded up: `formatINRExact`). The contract's payout threshold is not in
    the response and is not reflected. Without live balances the pages print
    the designed figures, not `DEMO_EARNINGS` mapped (that would print
    ₹41,090 beside platform rows summing to ₹1,84,320). A reply for another
    publisher id, like any answer the API gave, is a Banner (64).

**Marketing** (`/`, `/login`, `/terms`, `/privacy`, `/contact`)

51. `/` is static: every figure comes from `lib/site-copy.ts` through
    `components/marketing/copy.ts`; the creator poster is dropped when
    `MARKETING_CLAIMS.creatorsFree` is false (and `#creators` with it).
    Between 900 and 1279px the H1 and poster title scale with the viewport
    (exact at 1280); below 900px everything stacks on 20px gutters (H1,
    stats and poster title 44px, plan names 40px). A skip link and visually
    hidden h2s ("How it works", "Pricing for brands") were added. Copy claims
    that are not numbers ("Live in a day", "Approved earnings settle
    weekly", "No fee, no minimum followers") are still literal in
    `copy.ts`, not in site-copy.
52. `/login` checks the token's shape only (it strips "Bearer " and line
    breaks, refuses empty, malformed, unreadable and expired tokens); the
    claims it shows are read from the token and labelled unverified — the
    API checks the signature. A publisher id must be a uuid (stored
    lower-case); blank keeps a saved token; blocked storage shows a Banner
    and disables Continue. The page is noindex. `/contact` publishes no
    email, phone or form until launch; terms and privacy are "being
    prepared".

**Onboarding** (`/join`, 2a / 3a)

53. Demo flows, nothing verified: no SMS is sent and any 6 digits pass (the
    number must still be a valid +91 mobile; changing it invalidates the
    code); "Connect" fills in a TEST account (no OAuth); the PAN line reads
    "Verified · DEMO PRIYA NAIR — demo, no PAN check was made"; the wallet
    top-up takes no payment and creates no wallet. Platform connections, PAN
    and payout details are never sent to the API and nothing is persisted (a
    reload restarts at step 1).
54. Rules set here (placeholders pending business decisions): bank account
    9–18 digits (spaces and hyphens ignored); IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`;
    website http(s) with a dotted host (`https://` added); Telegram `@name`,
    `t.me/…` or `telegram.me/…`, 5–32 characters, invite links refused;
    email a basic shape; top-up optional whole rupees, ≤ 9 digits, kept in
    paise; full name 2–100 characters with a letter; brand / agency GSTIN
    optional and website required. A website or Telegram channel counts as
    "a platform".
55. Consent wording is the design's draft (no legal conclusion): "Creator
    Terms" links to `/terms` in a new tab (publishers see the same wording);
    the ASCI guidelines are not linked (no URL decided); brands and agencies
    consent to the "Terms of use".
56. Live submit: `POST /v1/publishers` with `{legal_name, country: 'IN'}` and
    one `Idempotency-Key` per legal name per page session, only for a creator
    / publisher with a dev token; 201 stores the new id as
    `paparazzi_publisher_id`. `NETWORK_UNREACHABLE` / `UPSTREAM_UNAVAILABLE`
    show a labelled demo result with "Try again"; any other error is a
    Banner and nothing is created. Steps use `history.pushState(null, …)`
    (Next 14's `__NA` flag in `history.state` otherwise stops
    `useSearchParams` syncing). Fields start empty (the mock draws the
    filled state); the 3a columns sit in the 5fr / 7fr shell (634px against
    the drawn 558px, so the step 2 lead wraps differently); phones show a
    step strip with short labels. The home page's `?plan=starter` ("Start
    free") is read (69): it preselects the brand flow, is shown under each
    brand step's title and stays in the URL; the design has no plan step, so
    nothing more is built for it.

**Creator app** (`/app/*`)

57. Overview / Reports (1c, 3d): 7d | 30d | 90d changes title and data (late
    replies ignored); the 90d chart is 13 weekly bars. Top links are the same
    for every range (the drawn rows exceed 30-day earnings, so they are
    all-time). Reports splits the designed totals by offer × platform, scales
    7d / 90d to the Overview totals and keeps the designed non-linear funnel
    bars; a "By day / week / month" table under the drawn area makes "Group
    by" do something (the one structural addition — drop it to match 3d
    exactly). The phone overview has no range switch (1e draws none).
    `DEMO_MY_LINKS` puts `story-12` (Demo Rail Trips) on Meta although that
    offer allows YouTube and Snapchat (as drawn); Reports gives Rail a Meta
    share so its filters stay consistent.
58. Offers / links (1d, 1e, 3c): `/app/offers` never calls `GET /v1/offers`
    (it returns the raw merchant `offer_url` to any signed-in role — an API
    item to fix before a creator screen uses it). "Highest payout" ranks by
    rupees per conversion; a percentage payout uses a test-only reference
    order value (Demo Style Festive ₹1,400, Demo Rail Trips ₹500, never
    shown) so the drawn order reproduces — a product decision (e.g. brands
    supplying an average order value). The landing page must be on one of
    the offer's allowed hosts by exact match, like the API's
    `allowed_domains`. Only Demo Ludo Arena needs approval; "Apply" is a
    demo dialog (stored in this browser, nothing sent) and the link then
    carries Review status. "Attribution 30 days / 7 days" is placeholder
    copy: no attribution window is implemented. QR: error correction M, 8px
    modules, 4-module margin, 1-bit greyscale PNG
    (`qrcode-generator@2.0.4`, MIT; `lib/qr.ts`, loaded only by Download QR).
    Live minting sits in an inline "Live tracked link" section (not a dialog)
    with pasted uuids (67); editing the generator after a live mint returns
    the Generated box to the demo preview. A demo link keeps the drawn
    display text, but Copy link, Download QR and Share carry the reserved
    host `afflino.demo.invalid` (the readable format is not implemented, so a
    copied demo link must not look like a working afflino.com URL), and the
    share toast says the link is not tracked. On the phone detail
    page the shell's top bar and tab bar stay (1e hides both; the sticky
    footer sits above the tab bar) and a "Disclosure text" box is added
    (every copy / share action offers the #ad line); "Sort" is hidden on
    phones (3f).
59. Payouts / settings (2c, 2d, 3f): Withdraw takes whole rupees from the
    ₹500 minimum (gross, inclusive) up to the available balance; TDS uses
    the site-copy rate rounded half-up to the rupee (the design's ₹513); a
    live Withdraw moves no money and explains that batches are prepared and
    approved by a second person (there is no publisher withdrawal endpoint);
    it names no destination ("the payout account the finance team holds for
    you"), because the payout method is demo data with no payee endpoint —
    with live balances the method cell carries its own Demo badge and the
    phone panel drops "to <method>". The PAN line reads "PAN not checked
    (demo)" (2c draws "PAN verified"; no check exists).
    Exports carry a TEST row first. Desktop 2c / 2d have hidden h1s (no
    drawn title); "Raise a ticket →", "Statements →" and, on phones, "Change
    payout method →" were added. Settings is one form over five sections;
    Save is enabled only when something changed and floats at the bottom
    with unsaved changes; the saved payout method also shows on Payouts.
    The 3f "Available" panel sets 13px ground-coloured text on the accent
    (about 3.7:1, below WCAG AA for small text) as drawn — a design decision
    to revisit. **Tax, open:** site-copy's TDS 1% under 194-O is a
    placeholder; the rate and even the section for creator commissions need
    the tax adviser (the maths handles fractional rates).

**Brand** (`/brand/*`, 2b / 3b / 3f)

60. All TEST data (v1 has no brand endpoints). Read from 2b and needing
    business confirmation: the budget cap covers creator payouts only and
    the network fee is billed on top (₹18.4L ÷ 10,212 ≈ ₹180); the fee is
    rounded half-up to the paisa and is display only (nothing is posted to
    the ledger). Estimated reach is a demo table per platform (Meta 22–30M,
    YouTube 10–14M, Snapchat 6–8M, Telegram 2–3M → the drawn 38–52M), not a
    forecast. Builder steps 02–04 are this build's design, not the owner's;
    the builder opens pre-filled with the drawn example; the preview card
    also lists allowed platforms. The network fee is billed on approved
    conversions (Billing: 8% of 8,934 × ₹180 = ₹1,28,649.60, "8% of
    ₹16,08,120 approved conversions to date"), the base /brand/conversions
    bills ("Approved · Billed at the offer's payout", "Rejected · Not
    billed"); the drawn ₹18.4L Spend counts all 10,212 sign-ups and is
    labelled so. Landing pages must be https on the
    brand's website domain (subdomains allowed); creators never see them.
    GSTIN is format-checked only. Admin review is not simulated: a submitted
    offer stays "In review" and never reaches `/admin`. Agency client
    workspaces show the same TEST figures under the client's name; the
    sidebar footer then prints "<category> · agency client", not the client's
    own spend, so one screen never shows two spends. Brand Settings enables
    Save only when a normalised value changed. On phones
    `/brand` is the 3f composition (no Top creators table).

**Agency and admin** (`/agency`, `/admin/*`, 3e / 2e)

61. Agency share: one rate for the whole roster, whole numbers 0–50,
    default `DEFAULT_AGENCY_SHARE_PCT`; share = round(earned × pct / 100),
    half-up to the paisa; per-creator rates (the handover's
    `roster[{sharePct}]`) are not built. Only the three drawn clients exist
    (the header still says 6); pending clients are not links; the dialogs
    send no email. The share control sits under the roster table so the
    drawn area stays exact.
62. Admin queue: counts are 212 / 14 / 76 / 122 minus the sample items
    approved or rejected in this browser; only rejection needs a note (≤ 500
    characters); decisions update every admin page (approving Demo
    CardMint's first offer makes the brand Active). The undrawn pages'
    figures are made to agree with 2e (fraud signals sum to 1,284 flagged
    and 122 cases, KYC buckets to 18,406, September fees to ₹52.6L); fraud
    thresholds are demo values and the pages say that no fraud detection,
    KYC or PAN verification exists. Settlements is read-only and explains
    the API's maker-checker flow. 2e gains two tabs (Suspense, Looks); where
    the eight tabs do not fit (phones, 761–900px) the strip scrolls with its
    active tab centred on every route and an edge fade on the side that has
    more. Every admin page follows 2e's template: no page header (suspense
    and looks dropped theirs), the badge beside the section label, the page
    note directly under the label, Review / View in a trailing Action
    column. Lists and tables use one neutral model tag for every model
    (`LIST_MODEL_TAG`); the drawn variants stay on the 1d cards and the 3b
    preview.

**Shop** (`/shop`, `/looks/*`, `/saved`)

63. No artboard: composed from 1d's ruled grid and 1e's phone get-link
    layout on the 40px marketing gutters (cells 24px 40px), with a tab row
    ("Shop the looks" | "Saved · n"). Covers are grayscale; the gradient
    placeholder is grayscale at 45% on the surface fill; grid cells crop 4:3
    weighted to the upper third, detail pages show the whole photo
    letterboxed and never enlarged. The disabled CTA is the outlined
    secondary look. The disclosure is a panel above the products on look and
    item pages and a standing line on `/shop` and `/saved` (no longer in
    the layout, which printed it twice); its wording is unchanged, in one
    constant `SHOP_DISCLOSURE` (`components/Disclosure.tsx`), pending
    counsel. No price sort (the list endpoint has no prices). Demo wishlist
    entries are recognised by a non-uuid look id. Prices print exactly
    (₹1,499.50, never rounded). When the API fails for a live look id the
    look and item pages render the shop's error state ("temporarily
    unavailable"), never a 404: the look may exist (`lookOrMiss`).

**Open foundation items** (worked around locally, not changed): `Banner`'s
title wraps beside a long message and its fixed role cannot pre-exist as a
live region; `TagButton` does not forward refs; `SelectableCard` takes no
`id` / `aria-describedby`; (fixed: every Button is 44px tall on phones, so
`EmptyState`'s action is too, and `TagButton` has a 44px hit area);
`Kpi` has no step between 760px and the 4-cell desktop (pages add their own
at 1000–1240px); `PageHeader` titles can wrap into the actions; `AppShell`
has no detail mode that hides the tab bar (1e) (it can now hide the phone
top bar per path); `statusTag` has no mapping
for "Rejected" or "Due"; `formatPayout` prints 12.5% as "13%" (the brand
uses its own `formatBps`); `lib/demo/afflino.ts` marks every offer
`requiresApproval: false` (overridden in `lib/demo/links.ts`); an `sr-only`
span inside a button yields a stray space in its name (aria-label used
instead).

## Review fixes, second pass (2026-09-29)

64. **An unreachable API and an answer the API gave are different states.**
    `withDemoFallback` returns `{ value, demo, error }`. Only
    `NETWORK_UNREACHABLE` / `UPSTREAM_UNAVAILABLE` (the proxy's 502) show
    `<DemoBadge variant="fallback" />` ("Demo data — API unreachable"). Any
    answer — 401 (missing or expired token: "Sign in to see …", link to
    /login), 403 (the role cannot read it), 404 (for earnings: "This
    publisher id is not in your organisation"), 400, 5xx — is a top Banner
    naming it (`fallbackNotice`, `components/FallbackBanner`) with the plain
    "Demo data" badge. Signed out (no token) the earnings, disputes and
    suspense pages make no call at all and show their designed demo state
    with "Demo data"; with a token but no saved publisher id the creator
    pages ask for one (Banner) instead of sending `DEMO_PUBLISHER_ID`, which
    is never sent any more. Payouts shows its badge from the first paint
    (its tables are demo in every state). On `/admin/suspense` a filter the
    API rejects (400) is an inline error that keeps the rows on screen.
65. **Bodyless POSTs carry no JSON content type.** `apiFetch` sets
    `Content-Type: application/json` only with a body: Fastify rejects an
    empty body declared as JSON, which made every "Retry attribution" a 500.
    The API now answers Fastify's own client errors (`FST_ERR_*` with a 4xx
    status) as that status with `VALIDATION_ERROR` instead of `INTERNAL`
    (`packages/api/src/errors.ts`).
66. **Suspense queue.** Amounts print in each row's own currency with its
    decimals (`formatMoneyExact`: ₹1,234.50, $14.99), never rounded; the
    date filters are India calendar days (from 00:00 IST, to 23:59:59.999
    IST; the API's bounds are inclusive), matching the Received column
    ("21 Sep · 14:42"); Reviewed is "Yes" / "No"; reasons are sentence case;
    "Retry attribution" is disabled on a row with no click reference, with
    the reason as visible text; only the newest load writes the table.
67. **Live minting takes pasted uuids.** No listing endpoint exists for
    properties, programmes, offers or placements, so the four ids are typed
    or pasted, checked for shape, remembered in this browser
    (`afflino_live_mint_ids_v1`); the TEST ids are only suggestions (a real
    API does not know them). Each unchanged set of ids carries one
    `Idempotency-Key` (`lib/idempotency.ts`), so a retry after a timeout
    replays the first link instead of minting a second.
68. **Disputes are filed for the saved publisher.** With a publisher id
    saved (/login, /join) the list is `GET /v1/disputes?publisher_id=` and
    the ticket carries `publisher_id` (the API checks it belongs to the
    token's organisation); each unchanged submission carries one
    `Idempotency-Key`. "What happened" is a textarea; the reference hint no
    longer shows the API field name.
69. **`/join?plan=`** (`starter` | `network`, `lib/site-copy.ts` PRICING)
    preselects the brand flow when no role is given, shows "Plan · Starter ·
    ₹0 / month · 15% network fee on approved payouts, picked on the pricing
    page. Compare plans" under each brand step's title, stays in the URL
    while the role is brand, and is named in the demo result ("the Starter
    plan you picked is not recorded either"). The fallback result says "Not
    submitted" / "Could not reach the API.", not "Setup complete".
70. **Phones and focus.** Every Button is at least 44px tall at 760px and
    below (the handover README's rule; `touch` is no longer needed for it);
    TagButton chips keep their drawn 25px with a transparent 44px hit area;
    the phone top bar's wordmark and account box have 44px hit areas around
    the drawn 32px box; statement tables stack into rows on phones. Focus
    rings on the sidebar items, the logo row, the workspace switcher and the
    phone tabs are drawn inside the element (`outline-offset: -4px`), since
    the scrolling sidebar and the viewport edge clipped their sides.
71. **Text contrast.** Text in the raw accent (#EC3013, 3.8:1 on the ground)
    failed WCAG AA at the 11–14px it is set in: ghost buttons, outline tags
    and filter chips, the marketing nav's hover / current link and the
    workspace switcher's toggle now use accent-700 (6.4:1); outline borders
    keep the accent (3:1 is enough for a non-text edge). **Open, for the
    owner:** the primary button (ground-coloured 14px bold on the accent
    fill, 3.8:1, as the handover's styles.css draws it) is unchanged, like
    the 3f panel (59); an accent-700 fill or larger labels would pass.
72. **Smaller fixes.** Field suffixes ("(optional)") inherit the uppercase
    eyebrow, as 3a / 1e draw them; the demo PAN line is one component
    (`components/DemoPanHint`) on onboarding and settings; Settings' phone
    rows keep their action inline; Statements prints the ledger exactly, a
    "Balance" KPI, IDs in one face and one date format; KPI eyebrows join
    "· Sep" with no-break spaces; every KPI in a strip has a meta line on
    /admin/offers and /admin/settlements; fraud signal cells reserve two
    title lines; /admin/looks shares the width in six columns from 1100px
    (a visible scrollbar below); the stacked-table labels are always the body
    face; brand offer row actions and every StackTable action column are
    flush left under an "Action" header; Platforms never wrap after a dot;
    the demo requests list says the rest of the pending requests are not in
    the demo data once its sample is decided; phones reach
    `/brand/conversions` ("Review conversions →" on the 3f Today and on
    /brand/creators) and `/app/reports` ("Reports →" on the 1e Home), which
    have no tab. Brand demo storage ignores a stored partition that is not
    shaped like its seed (a hand-edited `null` crashed `/brand/conversions`),
    and `app/error.tsx` keeps any other render error inside the design
    system. `/app`, `/brand`, `/agency`, `/admin` and `/join` are noindex
    (no robots.txt disallow: a crawler must fetch a page to see its
    noindex). The `/api` proxy drops cookies both ways (the API is
    bearer-only and sets none).

## Standalone app (2026-09-29)

73. **Standalone since 2026-09-29** (history, not instructions).
    Afflino is its own website and app: the shop is Afflino's consumer shop,
    items 21 and 27 and the `/api` proxy's comment now name
    `docker-compose.prod.yml` and the api image instead of the shared host's
    compose file, and the live mint form points at `db/seed-network.ts` for
    real ids. No route, component or behaviour changed.

## Site URL, search and the indexing gate (2026-09-29)

74. **`SITE_URL`** (server runtime, default `https://afflino.com`; only the
    origin of an absolute http(s) URL is used, anything else falls back to
    the default so a typo never canonicalises to a foreign host) is
    `metadataBase`; the root metadata (`lib/seo.ts` `rootMetadata`) sets the
    title template, the description from `lib/site-copy.ts`
    (`SITE_DESCRIPTION`, also the manifest's), Open Graph (site name,
    `website`, `en_IN`, og:url, `/icons/icon-512.png` — the only site image
    there is) and a `summary` Twitter card. The marketing and shop pages set
    `<link rel="canonical">` and og:url on their own path (`pageMetadata`;
    Next replaces rather than merges a parent's openGraph, so each page
    carries the full block). The home page's canonical renders as
    `https://afflino.com` (Next drops the root slash); the sitemap writes
    `https://afflino.com/` — the same URL.
75. **`SITE_INDEXING`** (server runtime, read per request). Exactly `on`
    (case-insensitive, trimmed) opens the site: robots.txt allows `/`,
    disallows `/app /brand /agency /admin /join /login /api /dev /saved`
    (plus an `Allow: /apple-icon.png`, which `/app` would otherwise match as
    a prefix) and names `https://<SITE_URL host>/sitemap.xml`; the sitemap
    lists `/`, `/shop` and the live catalogue's looks. Anything
    else — unset, empty, `off`, a typo — is **pre-launch**: robots.txt is
    `Disallow: /` with no sitemap line, the sitemap is an empty urlset (the
    catalogue is not read), and the root metadata adds
    `robots: noindex, nofollow`, which every public page inherits (Next merges
    metadata shallowly; the app areas, `/join`, `/login` and `/dev` set their
    own noindex, and a test asserts no `robots:` anywhere in `app/` says
    otherwise; another checks that every disallowed area that renders HTML
    declares noindex, `/saved` included). Why closed by default: the public
    pages carry placeholder
    prices, fees, TDS figures, a validation window, a minimum withdrawal and
    legal stubs (`lib/site-copy.ts`) the owner has not confirmed.
    docker-compose.prod.yml passes `${SITE_INDEXING:-off}`. Tests:
    `test/seo.test.ts`.
76. **Sitemap contents.** Demo data (no `WEB_API_TOKEN`, or the API
    unreachable) contributes no look, and neither does a TEST-labelled look
    from the live API (`isTestLabelledTitle`: a title starting with the word
    "Demo", which is how the network seed's `--with-demo-programme` looks are
    titled — CLAUDE.md invariant 11). Conservative: a real look titled
    "Demo …" is simply not listed. The look and item pages of those looks
    (and of the web's own demo looks) are reachable from `/shop`, so they
    carry `noindex, nofollow` themselves (`shopDetailMetadata`: the
    catalogue result's `demo` flag, or a TEST-labelled look or item title;
    2026-09-29). `/contact`, `/terms` and `/privacy` stay out of the
    sitemap while they are stubs.
77. **robots.txt disallow vs noindex.** Item 72 above kept the app areas out
    of robots.txt so a crawler could see their noindex; the indexing gate
    now disallows them explicitly (the brief for afflino.com asked for it).
    Trade-off: a disallowed URL that is linked from elsewhere can still be
    listed URL-only (the crawler never fetches it, so never sees the
    noindex). The noindex stays on those pages as the second line.
78. **A pre-launch notice, added and removed on 2026-09-29** (history).
    A review added a full-width "Preview: … placeholders" note above the
    nav of every marketing and shop page while `SITE_INDEXING` was off,
    because the figures in `lib/site-copy.ts` were then unconfirmed. The
    owner confirmed them the same day ("figures are confirmed, keep them"),
    so the note, its component and its copy were removed; the pages show the
    confirmed figures, and `test/site-copy.test.ts` pins them. Opening the
    site to search engines stays the owner's switch (items 74–77).

## Amazon.in Associates in the shop (2026-09-29)

79. **What an Amazon offer looks like** (`components/shop/model.ts`
    `offerCopy`, `ItemRow`, the item page). The API tells the shop an offer
    is Amazon's by `offer.connector === 'amazon-associates'`
    (`lib/site-copy.ts` `AMAZON_IN.connector`), never by the merchant's name.
    Then: the call to action reads "Buy on Amazon.in" (the brief: "a "Buy on
    Amazon.in" CTA"; PR 20: no confusion about where the order happens) and
    is still only the tracked `/r/{token}` link, or the disabled control
    without one; the Associate statement ("As an Amazon Associate I earn
    from qualifying purchases.", OA §10, verbatim) sits right under it and
    in the look / item page's disclosure panel, beside the shop's own line —
    always, and first: the programme's own disclosure from the API is shown
    only after it, minus the statement if it repeats it
    (`amazonDisclosures`), so an operator's text can never replace it; the
    item page says "You complete the purchase on Amazon.in; Amazon.in's
    terms apply." (`AMAZON_IN.purchaseNote`; it used to say "Payment,
    delivery and returns are handled by Amazon.in", wrong for third-party
    sellers' listings — LR: no misleading claims about Amazon's policies);
    a look with Amazon items shows "Affiliate links: Yes (we earn from
    qualifying purchases)" where other looks show "Sponsored"
    (`lookRelationshipFact`: "Sponsored: No" beside commissioned links
    could read as "no paid relationship"). The two button labels, the
    purchase note and the look fact are drafts pending counsel (the
    amazon.in Trademark Guidelines page renders empty); the statement, the
    disclaimer and the attribution line are Amazon's own text, pinned by
    `test/amazon-shop.test.ts`.
80. **Prices only as the API sends them.** The API returns `price_minor`
    only when Amazon's product API supplied it less than 1 hour ago (the
    Creators API's "Offers | 1 hour"; OA §11's 24 hours is the outer limit),
    with `price_as_of`; otherwise null, and then `stock_status`
    `unknown` too (availability is under the same rule). The shop never
    computes or keeps a price itself: with one it shows "Amazon.in Price",
    the amount, "(as of DD/MM/YYYY HH:MM IST)" (`lib/format.ts`
    `priceAsOfLabel`, fixed UTC+05:30, always with the date — OA §11's
    example: "Amazon.in Price: Rs.3500 (as of 13/07/2013 14:11 IST -
    Details)") and Amazon's price disclaimer adjacent (OA §11 allows
    "adjacent or via a link or popup"; adjacent was chosen, so no "Details"
    link), plus OA §11's attribution line under the list; without one it
    shows "See price on Amazon.in" in the price's place and no stock. The
    freshness line ("Price valid for …", from `fresh_until`) is not shown
    for a time-stamped price: `fresh_until` is how long the offer stays
    linkable (30 days), not how long its price is good. The page cache
    (`revalidate: 60`) can show a price up to 60 s after the API stopped
    returning it, i.e. at most 1 h 1 min after Amazon supplied it.
81. **The wishlist keeps no Amazon price** (`storablePrice`,
    `lib/saved.ts`). An Amazon entry is saved with `price_minor: null` and
    `priceNotStored: true` — `toggleSaved` drops a price even if one is
    passed — and `/saved` says "Price not stored — open the product for it".
    Entries saved before 2026-09-29 are unchanged (no Amazon offer existed).
82. **The footer statement is the owner's switch** (`lib/site.ts`
    `amazonAssociate`, `components/shell/MarketingFooter.tsx`).
    `AMAZON_ASSOCIATE=on` (server runtime) adds the Associate statement to
    every marketing and shop page's footer (help GPXFHVYZMTGPUMPE: "identify
    yourself on your Site as an Amazon Associate"); anything else shows none,
    so the site never claims to be an Associate before the account exists.
    `deploy/linode/amazon.sh setup` turns it on (and restarts the web) as
    soon as the account is set up, shop placement or not; `links` and
    `shop` refuse while it is off.
    The app areas' shell has no footer and shows no Amazon offer.
83. **No Amazon URL anywhere in the web.** The API never returns
    `offer_url`; no source file under `app/`, `components/` or `lib/`
    names an amazon.in host, a `/dp/` path, a short `amzn` link or Amazon's
    image host (a test scans them; the production build's output was
    grepped too, 2026-09-29: none). The shop draws no Amazon image: a look
    of Amazon products gets the gradient placeholder (OA §11: images may
    not be stored).
84. **`/r/` in robots.txt.** With `SITE_INDEXING=on`, robots.txt also
    disallows `/r/` (`ROBOTS_DISALLOW_TRACKED_LINKS`, separate from the web's
    own areas because the redirect serves it): a crawler must not follow a
    tagged Amazon link (PR 27), and the redirect answers `X-Robots-Tag:
    noindex, nofollow` itself.
85. **What is still demo or open.** The demo catalogue has no Amazon item
    (demo data never names a real merchant; the Amazon rendering is covered
    by `test/amazon-shop.test.ts` and was checked on the rehearsal stack);
    the privacy page does not yet carry OA §5's third-party cookie
    disclosure (counsel, `docs/action-tracker.md`): it is `StubPage`, which
    carries `data-document-status="stub"` (`STUB_MARKER`), and
    `deploy/linode/amazon.sh links` / `shop` refuse while the served
    `/privacy` carries it; the look's cover for Amazon products is the
    placeholder.
86. **Suspense rows from Amazon** (`lib/api.ts`, `components/admin/suspenseModel.ts`).
    `SuspenseReasonCode` has the API's four tracking-ID codes
    (`TRACKING_ID_UNMAPPED`, `TRACKING_ID_IS_STORE_DEFAULT`,
    `TRACKING_ID_MAPPED_AFTER_SALE`, `ATTRIBUTION_CONFLICT`) with
    sentence-case labels, the item carries `returned_tracking_ref`, the
    row shows "tracking ID: <id>" when there is no click ref, and "Retry
    attribution" is allowed with either reference (the API retries against
    both, exact matches only). A test pins the labels against
    `docs/openapi.yaml`'s enum.
