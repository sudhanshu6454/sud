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
