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
32. **Claims and prices are placeholders** in one module, `lib/site-copy.ts`
    (400M reach, ₹0 upfront, T+7, ₹24,999/month, 15% / 8% fees, TDS 1% under
    194-O, 7-day validation, ₹500 minimum withdrawal) — to be confirmed by the
    business before launch. The creator disclosure line there is a draft
    pending counsel (docs/action-tracker.md, ASCI rows), not a compliant
    disclosure.
33. **Tracking is unchanged.** The design's first-party attribution cookie and
    readable `/r/{handle}/{offer}?s=` links are not implemented; the platform
    redirect stays `/r/{32-hex token}` with no cookies (counsel-gated).
34. **One app, one breakpoint.** The mobile artboards are the phone layout of
    the same PWA: ≤760px the sidebar becomes a top bar (wordmark + 32px account
    box → settings) and a fixed bottom tab bar; the marketing chrome collapses
    its links into a menu below 900px. The sidebar is sticky at 100vh (the
    artboards simply end at their content).
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
