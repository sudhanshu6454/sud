# @paparazzi/web — consumer shop, publisher portal, editorial console

Next.js 14 (App Router). The **consumer shop is live**: it reads the v1
catalogue API server-side and every merchant call-to-action is a tracked
redirect link (`/r/{token}`) or a visibly disabled control — never a raw
merchant URL (the API does not return one). The portal and console call the
API from the browser through the same-origin `/api/*` proxy.

## Screen map

| Route | Renders | Data |
|---|---|---|
| `/` | Home: search box, category chips (from the loaded looks), "Curated looks" grid, empty state | **live** — `GET /v1/looks` (all pages) |
| `/looks/[id]` | Look detail: cover image (or gradient placeholder), Sponsored label, source-page attribution, disclosure box, items with match badge, price + merchant + freshness, CTA | **live** — `GET /v1/looks/:id?placement_id=WEB_PLACEMENT_ID` |
| `/looks/[id]/items/[itemId]` | Product detail: match badge, price, merchant + stock, freshness, variant facts (size · colour · SKU), big CTA, "Payment, delivery and returns are handled by the merchant.", disclosure | **live** — same detail call; `itemId` is the `look_items` id |
| `/saved` | Wishlist (client only): entries from localStorage `saved-items`, each linking to its item page | local |
| `/api/*` | Same-origin proxy to the API (`app/api/[...path]/route.ts`) | pass-through |
| `/portal`, `/portal/links`, `/portal/statements`, `/portal/disputes` | Publisher portal | live where a v1 endpoint exists, demo-labelled otherwise (see ASSUMPTIONS 12–17) |
| `/console`, `/console/looks/[id]`, `/console/suspense` | Editorial console | local pipeline board; suspense view live |
| `/manifest.webmanifest` | PWA manifest | runtime env |

`/products/[id]` no longer exists: product ids are look-item ids and only
resolve through their look, so the product page lives under the look.

Unknown look or item ids return the Next `notFound()` page (HTTP 404) in
live mode; a malformed id (non-uuid) is a 404 too.

## Live vs demo

- **Live** when `WEB_API_TOKEN` is set and the API answers: home grid, look
  detail, item detail. Every fetch carries `next: { revalidate: 60 }`, so an
  API response is reused for 60 s across requests (Next data cache; the
  first request after the window may still serve the previous body while
  the cache refreshes in the background).
- **Demo** when `WEB_API_TOKEN` is missing or the API fails (network error,
  non-2xx other than a clean 404): the TEST-labelled catalogue in
  `lib/mock-data.ts` (titles "Demo …", merchants "Demo Merchant …",
  `linkUrl: null` everywhere) and the page renders `<DemoBadge />`
  ("demo data — API unreachable"). Demo items never carry a link, so their
  CTA is the disabled "Link not available yet" state.
- A live item **without a live offer** renders "Not available right now"
  (no price, no CTA). A live offer **without a minted link** renders the
  disabled "Link not available yet" control. A live offer **with a link**
  renders `<a href="{REDIRECT_BASE_URL}/r/{token}" rel="sponsored nofollow noopener">View at merchant</a>`
  (same tab; the redirect service 302s to the merchant).
- Still stubbed: the EN/हिं toggle (visual only), the wishlist (local only,
  no account sync), the console pipeline board (local state).

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `API_BASE` | server (runtime) | Origin of the v1 API as seen from the web server. Default `http://localhost:3000`; if unset and `NEXT_PUBLIC_API_BASE` is an absolute URL, that is used. Read on every request by the catalogue client **and** the `/api/*` proxy. |
| `WEB_API_TOKEN` | server (runtime), **secret** | Bearer JWT for a read-only role (`publisher_analyst`) in the shop's organisation. Never `NEXT_PUBLIC_`, never sent to the browser, never attached to proxied browser requests. Missing → demo mode. |
| `WEB_PLACEMENT_ID` | server (runtime) | uuid of the shop's own placement; appended as `placement_id` to the detail call so items carry their tracked links. Unset or non-uuid → detail call without placement (all CTAs disabled). |
| `NEXT_PUBLIC_API_BASE` | browser (build) | Base for portal/console browser calls. Default `/api` (same-origin proxy). An absolute URL calls the API directly (CORS is then the API's problem). |
| `NEXT_PUBLIC_SITE_NAME` | server (runtime) | Site name for the `<title>`, header brand, footer line and manifest. Default `Paparazzi Commerce`. All routes render on demand (`dynamic = 'force-dynamic'` in the root layout), so a rename needs a restart, not a rebuild. |

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
client's mapping and fallback rules, and `mint-links.mjs` end to end against
a stub API.

## Styling / PWA

CSS Modules only, mobile-first (360px baseline), system font stack, no
`next/font`. `app/manifest.ts` serves the manifest (`display: standalone`,
`theme_color: #111111`), `public/icon.svg` is an original placeholder icon;
no service worker yet. Cover images are plain `<img>` tags (remote hosts
vary per deployment, so `next/image` allow-lists are not used).
