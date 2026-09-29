# @paparazzi/web — Afflino web app (marketing, creator / brand / agency app, admin) and the consumer shop

Next.js 14.2 (App Router, TypeScript, CSS Modules; no Tailwind, no UI
library), built to the **Afflino** design handover ("Modernist": Archivo,
near-mono red on off-white, 0 radius, 2px rules). The mobile app is the phone
layout of the same PWA (one app breakpoint, 760px). The **consumer shop is
live**: it reads the v1 catalogue API server-side and every merchant
call-to-action is a tracked redirect link (`/r/{token}`) or a visibly
disabled control — never a raw merchant URL (the API does not return one).
The app areas call the API from the browser through the same-origin `/api/*`
proxy with the dev token from `/login`; where no v1 endpoint exists they show
TEST demo data with a visible `<DemoBadge />`.

## Screen map

Artboard ids are the handover's (`Afflino.dc.html`: 1a logo, 1b marketing,
1c creator overview, 1d offer browser, 1e phone home + get link, 2a
onboarding step 1, 2b brand dashboard, 2c payouts, 2d settings, 2e admin, 3a
onboarding steps 2–3, 3b offer builder, 3c link generator, 3d reports, 3e
agency, 3f phone offers / payouts / brand). "Not drawn" pages are composed
from the drawn parts (same grid, type and components). Data: **live** = a v1
call, **demo** = TEST data from `lib/demo/*.ts` with `<DemoBadge
variant="mock" />` ("Demo data"; no endpoint exists), **mixed** = both on one
page. A live call that cannot reach the API falls back to demo data with
`<DemoBadge variant="fallback" />` ("Demo data — API unreachable"); one
the API answered with an error (401, 403, 404, 400, 5xx) falls back with a
top Banner that names it and the plain "Demo data" badge; signed out (no
token) the page makes no call and shows its demo state (`lib/api.ts`
`withDemoFallback` / `fallbackNotice`, `components/FallbackBanner`).

Chrome per area: `(marketing)` and `(shop)` render the marketing nav + footer
(skip link first); `/app`, `/brand`, `/agency` render `AppShell` (220px
sidebar; phone top bar + bottom tabs); `/admin` renders `AdminShell` (56px
ink bar); `/join` has its own step panel. The shells show TEST demo accounts
until sign-in exists (`account.demo` → a badge in the sidebar footer).
`/app`, `/brand`, `/agency`, `/admin` and `/join` are noindex (their
layouts' metadata): unauthenticated TEST-data pages stay out of search
indexes.

| Route | Screen (artboard) | Data |
|---|---|---|
| `/` | Marketing site (1b; nav lockup and logo sizes from 1a): hero, stats, how it works (`#brands`), pricing (`#pricing`), creator poster (`#creators`) | static — every figure from `lib/site-copy.ts` (placeholders); no badge |
| `/login` | Dev sign-in (not drawn; the 1b hero grid): paste the API token (JWT stub) and an optional publisher id, "Continue to your dashboard →", "Sign out". Says plainly there is no sign-in yet; checks the token's shape only; noindex | local — localStorage `paparazzi_token` / `paparazzi_publisher_id` |
| `/terms`, `/privacy`, `/contact` | Honest stubs in the marketing type ("being prepared"; contact publishes no email or phone) | static |
| `/join` | Sign-up & onboarding, 3 steps (2a, 3a; phone: a step strip). `?role=creator\|publisher\|brand\|agency` preselects, `?step=2\|3\|done` (history-driven, Back/Forward keep input); `?plan=starter\|network` (the home page's "Start free") preselects the brand flow and is shown on its steps | **mixed** — OTP, platform connect, PAN "Verified", wallet top-up are labelled demo flows (nothing verified or charged); Finish makes a **live** `POST /v1/publishers` (`Idempotency-Key`) for a creator / publisher with a dev token; brands, agencies and signed-out users get a demo result that says nothing was created |
| `/app` | Creator overview (1c; 1e home on phones): KPIs, 7d \| 30d \| 90d, chart, platform split, top links | **mixed** — Unpaid earnings (pending + approved: earned, not yet paid out) and Next payout (max(collected − payable, 0), the same figure as Payouts' "Available to withdraw"; `lib/earnings.ts`) from **live** `GET /v1/publisher/earnings?publisher_id=` (only with a token and a saved publisher id; live amounts exact to the paisa); the rest demo; phones link to Reports |
| `/app/offers` | Offer browser (1d; 3f left on phones): search, category tags, sort, Apply for approval-gated offers | demo — `GET /v1/offers` is the shop's price feed and returns the raw merchant `offer_url`, so the browser never calls it |
| `/app/offers/[id]` | Offer detail + get link (1e on phones; desktop composed from 1d / 3c), terms, promo code, disclosure text | demo; unknown id → 404 inside the app shell (`app/app/not-found.tsx`) |
| `/app/links` | My links + link generator (3c): offer picker, landing page, sub-ID, Generated box (Copy link, Download QR, Disclosure text, Share), "My links" table; plus a "Live tracked link" section | **mixed** — generator and table demo (no link-listing endpoint); **live** `POST /v1/links` mints the real `/r/{32-hex}` link from four pasted uuids (no listing endpoint; TEST ids as suggestions; one `Idempotency-Key` per unchanged set; guard errors inline); API unreachable → a labelled, untracked `redirect.demo.invalid` link. A demo link's Copy / QR / Share payload is on the reserved host `afflino.demo.invalid` |
| `/app/reports` | Reports (3d): funnel, cities, sub-IDs, filters, a by-day/week/month table, Export CSV | demo |
| `/app/payouts` | Payouts (2c; 3f middle on phones): balances, Withdraw dialog (₹500 minimum, TDS placeholder), Payouts \| Conversions \| Clicks tables, Export CSV | **mixed** — the two balances from **live** `GET /v1/publisher/earnings` (Available = max(collected − payable, 0), Pending = pending, and a line naming approved earnings in neither; exact to the paisa); tables and payout method demo (the method cell carries its own badge with live balances); there is no withdrawal endpoint, so a live Withdraw only explains batches and names no destination |
| `/app/payouts/disputes` | Missing-commission tickets (not drawn; 3c grid) | **live** `GET /v1/disputes?publisher_id=` (demo fallback), `POST /v1/disputes` with the saved `publisher_id` and an `Idempotency-Key` (disabled on demo data) |
| `/app/payouts/statements` | Ledger drilldown + dispute history (not drawn) | demo (`lib/portal-demo.ts`): no statement endpoint; both tables stack into rows on phones |
| `/app/settings` | Settings & profile (2d): profile, platforms, payout, notifications, security in one form | demo — localStorage `afflino_demo_creator_settings` |
| `/brand` | Brand dashboard (2b; 3f right on phones): KPIs, creator requests (Approve / Decline), top creators | demo |
| `/brand/offers/new` | Offer builder (3b; steps 02–04 are not drawn): Basics, Payout, Audience, Assets; live preview card; Save draft / Submit | demo — localStorage `afflino_brand_offers_v1` |
| `/brand/offers` · `/brand/creators` · `/brand/conversions` · `/brand/billing` · `/brand/settings` | Offers (status filters, row actions), creators, conversions (Approve / Reject, Export CSV), billing (`#top-up` demo dialog, no payment), settings (not drawn) | demo — localStorage `afflino_brand_{offers,requests,conversions,settings}_v1`, per workspace |
| `/brand?workspace=<client id>` | An agency inside a client's brand workspace (3e → 2b): same screens, workspace switcher, every in-area link keeps the parameter (`withWorkspace()`); client ids `demo-payupi`, `demo-style`, `demo-ludo` | demo |
| `/agency` | Agency workspace (3e): brand clients (`#clients`), roster (`#roster`) with the agency share, Invite creator / Add brand client dialogs | demo — localStorage `afflino_agency_{share,invites,clients}_v1` |
| `/admin` | Admin review queue (2e): KPIs, filters, Review dialog (Request info / Reject / Approve) | demo — decisions in localStorage `afflino_admin_review_v1`, shared by every admin page; nothing is sent |
| `/admin/brands` · `/admin/creators` · `/admin/offers` · `/admin/fraud` · `/admin/settlements` | Admin lists in the 2e style (not drawn); fraud says no detection runs, creators says there is no KYC / PAN check, settlements is read-only and explains the API's maker-checker | demo |
| `/admin/suspense` | Suspense queue (not drawn) | **live** `GET /v1/suspense` (filters as India calendar days; a rejected filter keeps the rows; demo fallback), `POST /v1/suspense/:id/retry` (disabled on demo data and on rows with no click reference) and `/review`; amounts in each row's own currency, exact |
| `/admin/looks` · `/admin/looks/[id]` | Editorial looks pipeline board (six equal columns from 1100px) and product match review (not drawn) | local — `lib/console.ts` (localStorage `paparazzi_console_looks`, TEST demo looks); no review API |
| `/shop` | Afflino's consumer shop (no artboard; 1d's ruled grid on the 40px marketing gutters): search (Esc clears), category tags, sort (Newest, Most products, Title A–Z) | **live** `GET /v1/looks` (all pages), server-side with `WEB_API_TOKEN` |
| `/looks/[id]` | Look detail (5fr / 7fr like an offer detail): cover (grayscale, whole photo), Sponsored, source-page attribution, disclosure panel, item rows (match tag, price 24px / 800, merchant · stock, freshness, CTA) | **live** `GET /v1/looks/:id?placement_id=WEB_PLACEMENT_ID` |
| `/looks/[id]/items/[itemId]` | Product detail (1e's get-link layout on phones, sticky CTA + Save): match tag, price 36px, merchant + stock, freshness, variant facts, CTA, "Payment, delivery and returns are handled by the merchant.", disclosure | **live** — same detail call; `itemId` is the `look_items` id |
| `/saved` | Wishlist: a ruled list of localStorage `saved-items` entries | local; "Demo data" badge when an entry came from the demo catalogue |
| `/dev/ui` | Gallery of every UI primitive and state — **dev only** (404 when `NODE_ENV=production`) | TEST demo |
| `/api/*` | Same-origin proxy to the API (`app/api/[...path]/route.ts`) | pass-through |
| `/manifest.webmanifest`, `/icon.svg`, `/favicon.ico`, `/apple-icon.png`, `/icons/icon-{192,512}.png` | PWA manifest and icons (the Afflino mark) | runtime env |

Redirects (`next.config.mjs`, temporary 307): `/portal` → `/app`,
`/portal/links` → `/app/links`, `/portal/statements` → `/app/payouts/statements`,
`/portal/disputes` → `/app/payouts/disputes`, `/console` → `/admin/looks`,
`/console/looks/:id` → `/admin/looks/:id`, `/console/suspense` → `/admin/suspense`.

404s: an unmatched URL renders `app/not-found.tsx` in the bare root layout;
the shop (`app/(shop)/not-found.tsx`) and the creator app
(`app/app/not-found.tsx`) have their own so a miss keeps their chrome. Unknown
look or item ids are HTTP 404 in live mode (a non-uuid id too); when the API
fails for a live look id the page is the shop's error state
(`app/(shop)/error.tsx`, "temporarily unavailable"), never a 404. Any other
render error stays in the system through `app/error.tsx` (Banner + "Try
again"). The look and
item routes deliberately have no `loading.tsx`: in Next 14.2 a `loading.tsx`
turns a `notFound()` into a 200 (only `/shop` has a route skeleton).

## Live vs demo

- **Shop, live** when `WEB_API_TOKEN` is set and the API answers: `/shop`,
  look detail, item detail. Every fetch carries `next: { revalidate: 60 }`,
  so an API response is reused for 60 s across requests (Next data cache;
  the first request after the window may still serve the previous body
  while the cache refreshes in the background).
- **Shop, demo** when `WEB_API_TOKEN` is missing or the API fails (network
  error, non-2xx other than a clean 404; for a live look id the look and
  item pages show the outage instead, above): the TEST-labelled catalogue in
  `lib/mock-data.ts` (titles "Demo …", merchants "Demo Merchant …",
  `linkUrl: null` everywhere) with `<DemoBadge />` in the page header. Demo
  items never carry a link, so their CTA is the disabled "Link not available
  yet" state.
- A live item **without a live offer** renders "Not available right now"
  (no price, no CTA). A live offer **without a minted link** renders the
  disabled "Link not available yet" control (the outlined secondary look).
  A live offer **with a link** renders
  `<a href="{REDIRECT_BASE_URL}/r/{token}" rel="sponsored nofollow noopener">View at merchant →</a>`
  (same tab; the redirect service 302s to the merchant).
- **App areas**: the live calls are exactly the ones marked **live** in the
  screen map, each through `apiFetch` + `withDemoFallback` (`lib/api.ts`)
  with the bearer from localStorage `paparazzi_token` (`/login`). Everything
  else is TEST data in `lib/demo/*.ts` (`afflino.ts` is the handover's
  screen data, "Demo"-renamed one-for-one; `creator-overview`, `links`,
  `payouts`, `brand`, `agency`, `admin`, `onboarding` add what the undrawn
  states need, under the same rule). Demo rows print the design's readable
  link format (`afflino.com/r/demo-priya/demo-payupi?s=…`), while what a
  demo link copies, encodes in its QR or shares is on the reserved host
  `afflino.demo.invalid`; the platform only mints `/r/{32-hex token}` (no
  cookies, hashed IPs) and a live link always shows the API's URL. Offer copy says "attribution window", never
  "cookie": the platform sets none.
- Demo flows are labelled and never pretend to verify: no SMS is sent (any
  6-digit code passes), "Connect" fills in a TEST account (no OAuth), the PAN
  line says no check was made, top-ups and withdrawals move no money,
  applications and review decisions are kept in this browser only.
- Still stubbed: the wishlist (local only, no account sync); no locale
  switch.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `API_BASE` | server (runtime) | Origin of the v1 API as seen from the web server. Default `http://localhost:3000`; if unset and `NEXT_PUBLIC_API_BASE` is an absolute URL, that is used. Read on every request by the catalogue client **and** the `/api/*` proxy. |
| `WEB_API_TOKEN` | server (runtime), **secret** | Bearer JWT for a read-only role (`publisher_analyst`) in the shop's organisation. Never `NEXT_PUBLIC_`, never sent to the browser, never attached to proxied browser requests. Missing → demo mode. |
| `WEB_PLACEMENT_ID` | server (runtime) | uuid of the shop's own placement; appended as `placement_id` to the detail call so items carry their tracked links. Unset or non-uuid → detail call without placement (all CTAs disabled). |
| `NEXT_PUBLIC_API_BASE` | browser (build) | Base for the app areas' browser calls (`lib/api.ts`). Default `/api` (same-origin proxy). An absolute URL calls the API directly (CORS is then the API's problem). |
| `NEXT_PUBLIC_SITE_NAME` | server (runtime) | Site name for the `<title>` template (`%s · Afflino`), the footer line and the manifest. Default `Afflino`. The logo wordmark is always "afflino". All routes render on demand (`dynamic = 'force-dynamic'` in the root layout), so a rename needs a restart, not a rebuild. |
| `NEXT_DIST_DIR` | build / dev | Next's output directory (default `.next`). `NEXT_DIST_DIR=.next-dev next dev` keeps a dev server out of the build's `.next`, so `next build` / `next start` can run beside it. |

Browser-side (not environment): the app areas read the dev JWT from localStorage `paparazzi_token` and the publisher id from `paparazzi_publisher_id` (`lib/api.ts`); `/login` writes both. They are never sent anywhere but the API (through `/api`).

Where the catalogue token comes from today: the JWT dev stub —
`cd packages/api && JWT_SECRET=dev-only-change-me node scripts/mint-dev-token.mjs --org-id "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from organisations where slug='demo-org'")" --role publisher_analyst`
— until the real IdP lands (see the root pilot checklist).

## The `/api` proxy

`app/api/[...path]/route.ts` forwards `/api/<path>?<query>` to
`${API_BASE}/<path>?<query>` for every method, streaming the response back
with hop-by-hop headers dropped, and cookies dropped both ways (the API is
bearer-only and sets none: the web origin's `cookie` is not sent upstream
and an upstream `set-cookie` never reaches the browser). It resolves `API_BASE` **at request time**
(a `rewrites()` entry in `next.config.mjs` would be frozen into the routes
manifest at `next build`, which breaks deployments that pass `API_BASE` at
container start, as `docker-compose.prod.yml` does). The browser's own
`Authorization` header is forwarded untouched; the server's
`WEB_API_TOKEN` is never added. `GET /api/healthz` → `{"ok":true}` proves
the proxy.

## Minting the shop's links

Consumers only see links that exist. `packages/api/scripts/mint-links.mjs`
mints, for one placement, a tracked link for every live offer that has none
yet (idempotent: `Idempotency-Key: mint-links:<placement>:<offer_id>`,
re-running is a no-op). The token must be `publisher_owner`, `editor` or
`network_admin`; today that is the dev stub from `mint-dev-token.mjs`.

Dev machine (API on 3000, placement `demo-ig-bio-1` from `db/seed.ts`):

```bash
cd packages/api && API_BASE=http://127.0.0.1:3000 API_TOKEN="$(JWT_SECRET=dev-only-change-me node scripts/mint-dev-token.mjs --org-id "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from organisations where slug='demo-org'")" --role publisher_owner)" node scripts/mint-links.mjs --placement "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from placements where placement_key='demo-ig-bio-1'")" --dry-run
```

Drop `--dry-run` to mint. Output: one `minted …` / `would mint …` line per
offer and a `summary: looks=… items=… minted=… replayed=… skipped_linked=…
skipped_no_offer=… skipped_duplicate_offer=… failed=…` line; failures print
the API error code verbatim (`HTTP 403 PROGRAMME_NOT_APPROVED: …`) and the
exit code is 1. Exit 2 is a usage error (placement not a uuid, no token).

A container deployment runs the same script from the api image, which ships
it; the single-line commands (the web's read-only token, then the links for
the shop's placement `network-shop-web`) are in `docker/README.md`
("Operator scripts").

## Wishlist

`SaveButton` stores `{ lookId, itemId, lookTitle, brand, model, merchant,
price_minor, currency, savedAt }` under localStorage `saved-items`; `/saved`
renders those entries (price as of save time, stated on the page) and links
to `/looks/[lookId]/items/[itemId]`. The old `saved-products` key is ignored.

## Run

```bash
pnpm --filter @paparazzi/web typecheck
pnpm --filter @paparazzi/web build      # output: 'standalone' → .next/standalone/packages/web/server.js
cd packages/web && NEXT_DIST_DIR=.next-dev NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next dev -p 3300 -H 127.0.0.1
cd packages/web && NEXT_TELEMETRY_DISABLED=1 WEB_API_TOKEN=... WEB_PLACEMENT_ID=... API_BASE=http://127.0.0.1:3000 ./node_modules/.bin/next start -p 3320
```

The dev server runs in `.next-dev` so a `next build` (`.next`) and a
`next start` can run beside it. `next start` prints a warning that it does
not match `output: 'standalone'`; it still serves the build (the image runs
`node packages/web/server.js`). Without `WEB_API_TOKEN` or a reachable API
every page renders its demo state — that is what the handover draws.

## Tests

`packages/web/test/` (21 files, run by the root `vitest run`; `lib/` and the
tested component models use relative imports because the root vitest config
has no `@/` alias):

- `catalogue.test.ts`, `mint-links.test.ts` — the shop's catalogue client
  (mapping, fallback rules) and `mint-links.mjs` end to end against a stub API.
- `format.test.ts`, `validators.test.ts`, `shell-nav.test.ts`,
  `shared-lib.test.ts` — display formats (every demo row back to the string
  the mock prints; no original mock name survives), form validators, nav
  matching, and the shared `lib/csv.ts` / `lib/earnings.ts` / bank-field
  validators.
- `marketing.test.ts` — copy composed from site-copy, no retyped figure or
  cookie claim, contact without contact details, CTA hrefs, the dev sign-in
  checks.
- `onboarding.test.ts` — the step reducer, validation, URL helpers and the
  `POST /v1/publishers` mapping.
- `creator-overview.test.ts`, `creator-overview-reports.test.ts` — the 30d
  figures as designed, the earnings mapping, reports model and CSV.
- `links.test.ts`, `links-qr.test.ts` — link composition (every 3c row),
  landing-page and sub-ID rules, payout sorting, live minting against a stub
  API; an independent QR decoder reads the generated codes back.
- `payouts.test.ts`, `settings.test.ts` — balances, TDS, withdrawal rules,
  CSV; settings validation.
- `brand-offer.test.ts`, `brand-screens.test.ts` — offer builder rules and
  fee maths, the 2b / 3f figures, conversions, settings, top-up.
- `admin-queue.test.ts`, `agency-share.test.ts` — the review-queue reducer
  and counts; the agency share maths and dialogs.
- `shop.test.ts` — filters, sort, the three CTA states rendered to HTML, and
  source scans (no hex colours or raw radii, no "cookie", no `offer_url`,
  `rel="sponsored…"` only in `MerchantCta`).
- `live-api.test.ts`, `api-proxy.test.ts` — `apiFetch` (no JSON content type
  without a body), the fallback states (unreachable vs 401 / 403 / 404 /
  mismatch; no call without a token or publisher id), `Idempotency-Key`
  reuse, the suspense query's India-day bounds; the `/api` proxy's headers
  (bearer forwarded, cookies dropped both ways, `WEB_API_TOKEN` never
  added).

## Design system (Afflino "Modernist")

- **Tokens**: `app/globals.css` — the handover's token sheet verbatim
  (`_ds/modernist/styles.css`: colours, accent / neutral ramps, 4–32px
  spacing, radius 0, shadows) plus `--font-mono`; base element rules (body
  15px / 1.55, headings, ink links with an accent-700 hover, 2px accent
  `:focus-visible`, disabled native controls 45%). Values are ported from the
  rendered artboards where the handover prose differs (ASSUMPTIONS 29).
  Never hard-code a value a token carries.
- **Font**: Archivo (SIL OFL 1.1, `app/fonts/OFL.txt`), self-hosted with
  `next/font/local` from `app/fonts/*.woff2` (variable wght axis; latin and
  latin-ext faces, the latter carries ₹). No request to Google Fonts.
- **Primitives**: `components/ui` (import from `@/components/ui`): Button,
  Tag / TagButton / StatusTag / statusTag, Field, Input, Select, Textarea,
  Checkbox, Segmented, DataTable (+ `tableClasses`), KpiStrip / KpiCell,
  ProgressBar, BarChart, SelectableCardGroup, Dialog, Eyebrow, PageHeader,
  Mark / Wordmark / Lockup, Skeleton, EmptyState, Banner.
  `components/DemoBadge` is the demo-data label ("Demo data", "Demo data —
  API unreachable"; no outer margin, the placement spaces it). A `Field`
  around a group (Segmented, SelectableCardGroup) names it with
  `aria-labelledby`. Dialog body copy is 85% ink as a text colour, so a form
  inside a dialog keeps full-strength fields. `/dev/ui` shows every
  primitive and state on a dev server.
- **Shells**: `components/shell` — AppShell, AdminShell, MarketingNav,
  MarketingFooter, WorkspaceSwitcher, PageBody / PageNote / PageSection; nav
  models and `withWorkspace()` / `navInWorkspace()` in `areas.ts` (nav
  matching ignores `?query`).
- **Breakpoints**: 760px is the one app breakpoint (sidebar → top bar +
  fixed bottom tabs, phone compositions 1e / 3f, ≥44px targets: every
  Button is 44px tall on phones, TagButton chips have a 44px hit area; the
  top bar is hidden where 3f draws none, `/app/offers` and `/app/payouts`); the
  marketing chrome collapses its links into a menu below 900px. Pages add
  local steps where their content needs them between 761px and 1280px (KPI
  strips go 2 × 2, grids drop a column, panels stack); none scrolls
  sideways at 360, 900 or 1024.
- **Shared helpers**: `lib/site-copy.ts` (every marketing claim, price, fee,
  the TDS rate, the validation window, the minimum withdrawal and
  `CREATOR_DISCLOSURE_LINE` — all placeholders to confirm before launch),
  `lib/format.ts` (₹ with Indian grouping, lakh / crore compacts, counts,
  percentages, dates), `lib/validators.ts` (mobile, OTP, PAN, UPI, GSTIN,
  sub-ID, IFSC, bank account), `lib/csv.ts` (RFC 4180, formula-guarded, money
  from integer paise; every Export CSV), `lib/download.ts` (Blob downloads,
  CSV with a UTF-8 BOM), `lib/clipboard.ts` (copy with an execCommand
  fallback; "Copied" for 2s), `lib/earnings.ts` (the earnings buckets →
  balances, and `loadLiveEarnings`, the one earnings call), `lib/links.ts`
  (link composition, the QR file name, live minting), `lib/qr.ts` (the QR
  code and PNG, loaded only by Download QR), `lib/idempotency.ts` (one
  `Idempotency-Key` per unchanged payload),
  `lib/onboarding.ts`.
- **Area components**: `components/{marketing,onboarding,creator/*,brand,agency,admin,shop}`
  hold each area's screens and their pure models (the models are what the
  tests import).
- **Imports**: `@/…` resolves to the package root (tsconfig `paths`); files
  under `lib/` keep relative imports.

## How the screens were compared with the design

Each artboard of the handover was rendered 1:1 in Archivo to a PNG (plus its
markup with inline styles), and the pages were screenshotted with Playwright
Chromium at `deviceScaleFactor` 1 and compared by eye and by pixel diff, at
least two rounds per screen:

- Artboards that draw the sidebar (1c, 1d, 2b) and full-width pages (1b, 2a /
  3a, 2e) → the full page at 1280px wide.
- Content-only artboards (2c, 3b, 3c, 3d, 3e) → the `[data-shell-main]`
  element at a 1500px viewport (a 1280px content area, like the artboard);
  2d (960px) at 1180px.
- Phone artboards (1e, 3f) → 360 × 740 (the fold, then the full page).
- The artboard's label strip is 49px; the offset was subtracted.

What remains is sub-pixel text placement (the self-hosted Archivo against the
handover's Google Fonts copy sets text about 1px low), the "Demo …" names, the
demo badge, and the deviations listed in `ASSUMPTIONS.md` (2026-09-29,
"Afflino screens"). 900px and 1024px were checked on every screen. The
screenshot tooling was a session script (Playwright + the reference PNGs),
not part of this repository.

## Styling / PWA

CSS Modules only, no UI libraries; every module reads the tokens (the shop
test scans the shop's modules for hex colours, raw radii and shadows).
`app/manifest.ts` serves the manifest (`name` from `NEXT_PUBLIC_SITE_NAME`,
default Afflino, `short_name` afflino, `display: standalone`, `theme_color` /
`background_color` #F3F2F2); the icons are the Afflino mark (`app/icon.svg`,
`app/favicon.ico` 16 + 32, `app/apple-icon.png` 180,
`public/icons/icon-192.png` / `icon-512.png`); no service worker yet. Cover
images are plain `<img>` tags in grayscale (remote hosts vary per deployment,
so `next/image` allow-lists are not used); the shop never sets type on a
cover.

If `typecheck` reports modules missing under `.next/types` or `.next-dev/types`,
those are stale generated types from an earlier build: delete that directory.
