# @paparazzi/web — Afflino web app (marketing, creator / brand / agency app, admin) and the fleet shop

Next.js 14 (App Router), rebuilt to the **Afflino** design handover ("Modernist":
Archivo, near-mono red on off-white, 0 radius, 2px rules). The mobile app is the
phone layout of the same PWA (one breakpoint, 760px). The **consumer shop is
live**: it reads the v1 catalogue API server-side and every merchant
call-to-action is a tracked redirect link (`/r/{token}`) or a visibly disabled
control — never a raw merchant URL (the API does not return one). App pages call
the API from the browser through the same-origin `/api/*` proxy.

## Screen map

Chrome per area: `(marketing)` and `(shop)` route groups render the marketing
nav + footer; `/app`, `/brand`, `/agency` render `AppShell` (220px sidebar,
phone top bar + bottom tabs); `/admin` renders `AdminShell` (56px ink bar);
`/join` has none. Pages marked *placeholder* render `ScreenPlaceholder`
("Screen in progress") until their screen is built. Pages marked *live port*
are the pre-Afflino portal / console pages brought back at their new routes
with their logic unchanged, set on the Afflino primitives (no artboard draws
them; 3c builds on `/app/links`, 2c links to disputes and statements).

The shells show TEST demo accounts until sign-in is wired: every area layout
passes `account.demo`, so the sidebar footer carries `<DemoBadge />` (and, on
phones, the workspace switcher row does).

| Route | Renders (design artboard) | Data |
|---|---|---|
| `/` | Marketing site (1b) — *placeholder* | — |
| `/join` | Sign-up & onboarding, 3 steps (2a, 3a) — *placeholder* | — |
| `/login` | Dev sign-in: paste the API token (JWT stub) — *placeholder* | — |
| `/terms`, `/privacy`, `/contact` | Honest stubs ("being prepared") | — |
| `/app` · `/app/offers` · `/app/offers/[id]` · `/app/reports` · `/app/payouts` · `/app/settings` | Creator app: overview (1c), offer browser (1d), offer detail + get link (1e), reports (3d), payouts (2c), settings (2d) — *placeholders* | TEST demo (`lib/demo/afflino.ts`) until built against the API |
| `/app/links` | Tracked-link minting (was `/portal/links`) — *live port*; 3c (generator + "My links" table) builds on it | **live** `POST /v1/links` (API composes the URL; guard errors via `linkErrorMessage`); option lists TEST demo; API unreachable → a labelled, untracked `redirect.demo.invalid` URL |
| `/app/payouts/disputes` | Missing-commission tickets (was `/portal/disputes`) — *live port* | **live** `GET /v1/disputes` (demo fallback + badge), `POST /v1/disputes` (disabled on demo data) |
| `/app/payouts/statements` | Ledger drilldown + dispute history (was `/portal/statements`) — *live port* | TEST demo (`lib/portal-demo.ts`): no statement endpoint in v1 |
| `/brand` · `/brand/offers` · `/brand/offers/new` · `/brand/creators` · `/brand/conversions` · `/brand/billing` · `/brand/settings` | Brand workspace: overview (2b), offers, offer builder (3b), creators, conversions, billing, settings — *placeholders*. `?workspace=<client id>` (an agency in a client's workspace, 3e) switches the shell to that client with a workspace switcher (other clients, "Back to agency"); `app/brand/BrandShell.tsx` keeps the parameter on every brand nav link — in-page brand links should use `withWorkspace()` from `components/shell/areas.ts` | TEST demo |
| `/agency` | Agency workspace (3e) — *placeholder*; sidebar Workspace · Brand clients (`#clients`) · Roster (`#roster`) + workspace switcher into `/brand?workspace=<client id>`. No agency settings screen exists, so the phone account box is not a link | TEST demo |
| `/admin` · `/admin/brands` · `/admin/creators` · `/admin/offers` · `/admin/fraud` · `/admin/settlements` | Admin: review queue (2e), brands, creators, offers, fraud, settlements — *placeholders* | TEST demo |
| `/admin/suspense` | Suspense queue (was `/console/suspense`) — *live port* | **live** `GET /v1/suspense` (filters; demo fallback + badge), `POST /v1/suspense/:id/retry` and `/review` (disabled on demo data) |
| `/admin/looks` · `/admin/looks/[id]` | Editorial looks pipeline board and product match review (was `/console`, `/console/looks/[id]`) — *live port* | local: `lib/console.ts` (localStorage `paparazzi_console_looks`, TEST demo looks), no API wiring yet |
| `/shop` | The fleet's consumer shop grid (moved from `/`) | **live** — `GET /v1/looks` (all pages) |
| `/looks/[id]` | Look detail: cover image (or gradient placeholder), Sponsored label, source-page attribution, disclosure box, items with match badge, price + merchant + freshness, CTA | **live** — `GET /v1/looks/:id?placement_id=WEB_PLACEMENT_ID` |
| `/looks/[id]/items/[itemId]` | Product detail: match badge, price, merchant + stock, freshness, variant facts (size · colour · SKU), big CTA, "Payment, delivery and returns are handled by the merchant.", disclosure | **live** — same detail call; `itemId` is the `look_items` id |
| `/saved` | Wishlist (client only): entries from localStorage `saved-items`, each linking to its item page | local |
| `/dev/ui` | Gallery of every UI primitive and state — **dev only** (404 when `NODE_ENV=production`) | TEST demo |
| `/api/*` | Same-origin proxy to the API (`app/api/[...path]/route.ts`) | pass-through |
| `/manifest.webmanifest`, `/icon.svg`, `/favicon.ico`, `/apple-icon.png`, `/icons/icon-{192,512}.png` | PWA manifest and icons (the Afflino mark) | runtime env |

Redirects (`next.config.mjs`, temporary 307): `/portal` → `/app`,
`/portal/links` → `/app/links`, `/portal/statements` → `/app/payouts/statements`,
`/portal/disputes` → `/app/payouts/disputes`, `/console` → `/admin/looks`,
`/console/looks/:id` → `/admin/looks/:id`, `/console/suspense` → `/admin/suspense`.
Every redirect target is a working page: links, disputes, statements,
suspense and the looks pipeline are live ports (above). The old `/portal`
dashboard's `GET /v1/publisher/earnings` call is not wired yet; the 1c
overview picks it up (`DEMO_EARNINGS` and `getPublisherId()` are still in
`lib/portal-demo.ts` / `lib/api.ts`).

`/products/[id]` no longer exists: product ids are look-item ids and only
resolve through their look, so the product page lives under the look.

Unknown look or item ids return the Next `notFound()` page (HTTP 404) in
live mode; a malformed id (non-uuid) is a 404 too.

## Live vs demo

- **Live** when `WEB_API_TOKEN` is set and the API answers: shop grid (`/shop`), look
  detail, item detail. Every fetch carries `next: { revalidate: 60 }`, so an
  API response is reused for 60 s across requests (Next data cache; the
  first request after the window may still serve the previous body while
  the cache refreshes in the background).
- **Demo** when `WEB_API_TOKEN` is missing or the API fails (network error,
  non-2xx other than a clean 404): the TEST-labelled catalogue in
  `lib/mock-data.ts` (titles "Demo …", merchants "Demo Merchant …",
  `linkUrl: null` everywhere) and the page renders `<DemoBadge />`
  ("Demo data — API unreachable"). Demo items never carry a link, so their
  CTA is the disabled "Link not available yet" state.
- A live item **without a live offer** renders "Not available right now"
  (no price, no CTA). A live offer **without a minted link** renders the
  disabled "Link not available yet" control. A live offer **with a link**
  renders `<a href="{REDIRECT_BASE_URL}/r/{token}" rel="sponsored nofollow noopener">View at merchant</a>`
  (same tab; the redirect service 302s to the merchant).
- Still stubbed: the wishlist (local only, no account sync). The old EN/हिं
  toggle went with the old header; no locale switch exists yet.
- The Afflino app screens (`/app`, `/brand`, `/agency`, `/admin`) show the
  TEST data in `lib/demo/afflino.ts` with `<DemoBadge />` wherever no v1
  endpoint serves them, and use `apiFetch` + `withDemoFallback` (`lib/api.ts`)
  where one does. Demo rows may print the design's readable link format
  (`afflino.com/r/demo-priya/demo-payupi?s=…`); the platform only mints
  `/r/{32-hex token}` (no cookies, hashed IPs), and live links always show the
  API's URL.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `API_BASE` | server (runtime) | Origin of the v1 API as seen from the web server. Default `http://localhost:3000`; if unset and `NEXT_PUBLIC_API_BASE` is an absolute URL, that is used. Read on every request by the catalogue client **and** the `/api/*` proxy. |
| `WEB_API_TOKEN` | server (runtime), **secret** | Bearer JWT for a read-only role (`publisher_analyst`) in the shop's organisation. Never `NEXT_PUBLIC_`, never sent to the browser, never attached to proxied browser requests. Missing → demo mode. |
| `WEB_PLACEMENT_ID` | server (runtime) | uuid of the shop's own placement; appended as `placement_id` to the detail call so items carry their tracked links. Unset or non-uuid → detail call without placement (all CTAs disabled). |
| `NEXT_PUBLIC_API_BASE` | browser (build) | Base for portal/console browser calls. Default `/api` (same-origin proxy). An absolute URL calls the API directly (CORS is then the API's problem). |
| `NEXT_PUBLIC_SITE_NAME` | server (runtime) | Site name for the `<title>` template (`%s · Afflino`), the footer line and the manifest. Default `Afflino`. The logo wordmark is always "afflino". All routes render on demand (`dynamic = 'force-dynamic'` in the root layout), so a rename needs a restart, not a rebuild. |
| `NEXT_DIST_DIR` | build / dev | Next's output directory (default `.next`). `NEXT_DIST_DIR=.next-dev next dev` keeps a dev server out of the build's `.next`. |

Where the catalogue token comes from today: the JWT dev stub —
`cd packages/api && JWT_SECRET=dev-only-change-me node scripts/mint-dev-token.mjs --org-id "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from organisations where slug='demo-org'")" --role publisher_analyst`
— until the real IdP lands (see the root pilot checklist).

## The `/api` proxy

`app/api/[...path]/route.ts` forwards `/api/<path>?<query>` to
`${API_BASE}/<path>?<query>` for every method, streaming the response back
with hop-by-hop headers dropped. It resolves `API_BASE` **at request time**
(a `rewrites()` entry in `next.config.mjs` would be frozen into the routes
manifest at `next build`, which breaks deployments that pass `API_BASE` at
container start, as `docker-compose.yml` does). The browser's own
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

Fleet server (no node on the host — run it inside the API container, token
typed at a hidden prompt, placement read from `.env`):

```bash
cd /opt/marketing-fleet && read -rs -p 'Mint token (publisher_owner): ' T && echo && docker compose exec -T -e API_BASE=http://127.0.0.1:3000 -e API_TOKEN="$T" affiliate_api node --input-type=module - --placement "$(grep '^AFFILIATE_WEB_PLACEMENT_ID=' .env | cut -d= -f2-)" < affiliate/packages/api/scripts/mint-links.mjs
```

## Wishlist

`SaveButton` stores `{ lookId, itemId, lookTitle, brand, model, merchant,
price_minor, currency, savedAt }` under localStorage `saved-items`; `/saved`
renders those entries (price as of save time, stated on the page) and links
to `/looks/[lookId]/items/[itemId]`. The old `saved-products` key is ignored.

## Run

```bash
pnpm --filter @paparazzi/web typecheck
pnpm --filter @paparazzi/web build      # output: 'standalone' → .next/standalone/packages/web/server.js
pnpm --filter @paparazzi/web dev
cd packages/web && WEB_API_TOKEN=... WEB_PLACEMENT_ID=... API_BASE=http://127.0.0.1:3000 ./node_modules/.bin/next start -p 3200
```

Tests (`packages/web/test/`, run by the root `vitest run`): the catalogue
client's mapping and fallback rules, `mint-links.mjs` end to end against
a stub API, the display formats (`format.test.ts`, including every demo row
formatted back to the string the mock prints) and the form validators
(`validators.test.ts`).

## Design system (Afflino "Modernist")

- **Tokens**: `app/globals.css` — the handover's token sheet verbatim (colours,
  accent / neutral ramps, 4–32px spacing, radius 0, shadows) plus
  `--font-mono`; base element rules (body 15px / 1.55, headings, ink links with
  an accent-700 hover, 2px accent `:focus-visible`, disabled native controls
  45% — components own any `aria-disabled` look). Never
  hard-code a value a token carries.
- **Font**: Archivo (SIL OFL 1.1, `app/fonts/OFL.txt`), self-hosted with
  `next/font/local` from `app/fonts/*.woff2` (variable wght axis, two faces:
  latin and latin-ext, the latter carries ₹). No request to Google Fonts from
  the browser.
- **Primitives**: `components/ui` (import from `@/components/ui`): Button,
  Tag / TagButton / StatusTag / statusTag, Field, Input, Select, Textarea,
  Checkbox, Segmented, DataTable (+ `tableClasses`), KpiStrip / KpiCell,
  ProgressBar, BarChart, SelectableCardGroup, Dialog, Eyebrow, PageHeader,
  Mark / Wordmark / Lockup, Skeleton, EmptyState, Banner. `components/DemoBadge`
  is the demo-data label ("Demo data", "Demo data — API unreachable").
  A `Field` around a group (Segmented, SelectableCardGroup; detected when it
  is the direct child, or `<Field group>`) renders its label as a `<span>`
  that names the group via `aria-labelledby`, never a dangling `<label for>`.
- **Shells**: `components/shell` — AppShell (`account.demo` → DemoBadge in the
  footer; `settingsHref` optional → the phone account box is then not a
  link), AdminShell, MarketingNav, MarketingFooter, WorkspaceSwitcher,
  ScreenPlaceholder, PageBody / PageNote / PageSection (content in the app
  gutters under a PageHeader); nav models and `withWorkspace()` /
  `navInWorkspace()` in `components/shell/areas.ts` (nav matching ignores
  `?query`).
- **Copy and data**: `lib/site-copy.ts` holds every marketing claim, price,
  fee, the TDS rate, the validation window, the minimum withdrawal and the
  creator disclosure line — all placeholders to confirm before launch.
  `lib/demo/afflino.ts` is the handover's screen data, TEST-labelled and
  "Demo"-renamed. `lib/format.ts` (₹ with Indian grouping, lakh / crore
  compacts, western-grouped counts, K / M compacts, percentages, dates) and
  `lib/validators.ts` (mobile, OTP, PAN, UPI, GSTIN, sub-ID).
- **Imports**: `@/…` resolves to the package root (tsconfig `paths`). Files under
  `lib/` keep relative imports — the root vitest config has no alias and the
  tests import `lib/` directly.
- `/dev/ui` shows every primitive and state (run a dev server:
  `cd packages/web && NEXT_DIST_DIR=.next-dev ./node_modules/.bin/next dev -p 3311`).

## Styling / PWA

CSS Modules only, no UI libraries. Mobile-first where it matters: the app
shells switch to the phone layout at 760px, the marketing chrome at 900px.
`app/manifest.ts` serves the manifest (`name` Afflino, `short_name` afflino,
`display: standalone`, `theme_color` / `background_color` #F3F2F2); the icons
are the Afflino mark (`app/icon.svg`, `app/favicon.ico` 16 + 32,
`app/apple-icon.png` 180, `public/icons/icon-192.png` / `icon-512.png`); no
service worker yet. Cover images are plain `<img>` tags (remote hosts vary per
deployment, so `next/image` allow-lists are not used). The shop pages were
moved, not restyled: they render on the new ground colour and font, but their
modules still hard-code the pre-Afflino hex greys and rounded radii
(`app/(shop)/**/page.module.css`, `components/{LookCard,LookGrid,MerchantCta,
MatchBadge,SaveButton,Disclosure}.module.css`: rounded white cards, a rounded
search box, pill chips). Re-pointing them to the tokens is a separate task.

If `typecheck` reports modules missing under `.next/types` or `.next-dev/types`,
those are stale generated types from an earlier build: delete that directory.
