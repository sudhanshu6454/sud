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
12. **Portal dashboard** (`/portal`): stat cards for clicks, matched
    transactions, paid (no v1 endpoint yet — always demo, labelled), and
    pending/approved/collected/payable from the earnings API with demo fallback.
    Publisher id from localStorage `paparazzi_publisher_id`, else the demo
    constant in `lib/api.ts`. Recent conversions table is mocked and labelled
    (no v1 endpoint).
13. **Link builder** (`/portal/links`): demo option lists (no listing endpoint
    in v1). POSTs to `/v1/links`; API error codes map to human messages
    (`PROGRAMME_NOT_APPROVED` → "programme not active", `OFFER_STALE` →
    "offer expired", `PROPERTY_FORBIDDEN` → "property not approved"). On network
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
    time, but the fleet's `docker-compose.yml` passes `API_BASE` at container
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
    `replayed`. On the fleet server (no node on the host) it runs inside the
    API container via `node --input-type=module -` with the script on stdin.
28. **Not verified here.** `docker/Dockerfile.web` was not rebuilt in this
    pass (out of this package's ownership); the standalone layout it expects
    (`.next/standalone/packages/web/server.js`) was confirmed to exist after
    `next build`.

## Review fixes (2026-09-29)

- **The `/api` proxy refuses `.` and `..` segments** (400): they survive `encodeURIComponent`
  and URL parsing would collapse them, climbing out of a path-prefixed `API_BASE`. Upstream
  calls time out after 30 s.
- **The proxy makes the API reachable from the public shop host.** That is no wider than
  `AFFILIATE_API_HOST` already is, but it means the API's own auth (the JWT stub) is the only
  gate on both hosts.
