# @paparazzi/web — Consumer PWA shell

Next.js 14 (App Router) consumer web app for the Paparazzi Affiliate Commerce
Platform. **All screens are STUBBED with local mock data — no API wiring yet
(phase 2).** No network calls are made at build or runtime.

## Screen map

| Route | Screen |
|---|---|
| `/` | Home / discovery: search stub, category chips (Fashion, Footwear, Bags, Accessories), budget chips (visual only), “Curated looks” grid of LookCards, “Sponsored” label where flagged, empty-state block |
| `/looks/[id]` | Look detail: hero placeholder, title, source-page attribution, affiliate disclosure box, product cards with match badges (“Exact item” / “Similar style”), price + merchant + freshness (“Price updated 2h ago — check current price at merchant”), “View at merchant” CTA (stubbed `href="#"`) |
| `/products/[id]` | Product detail: variant/size selector stub, match badge, merchant row, stock status, freshness timestamp, big “Shop at merchant” CTA (stubbed `href="#"`), note “Payment, delivery and returns are handled by the merchant.” |
| `/saved` | Wishlist (client component): reads `saved-products` from localStorage, empty state with CTA back home |

Shared shell: `app/layout.tsx` renders the header (brand + EN/हिं locale toggle stub + Saved link) and the footer with the affiliate-disclosure line.

## What's stubbed

- **Data**: `lib/mock-data.ts` (3 looks, 6 products). Replaced by real API data in phase 2.
- **Search**: filters the mock looks client-side; category/budget chips are visual only.
- **Locale toggle**: EN/हिं buttons do nothing — i18n is phase-2 work.
- **Merchant CTAs**: all “View at merchant” / “Shop at merchant” links use `href="#"`. In phase 2 these become signed redirect URLs from the redirect service (click id, attribution, sponsor flags).
- **Wishlist**: `SaveButton` writes to localStorage under `saved-products`; `/saved` reads it back. No account sync.
- **Media**: no remote images anywhere — all imagery is CSS gradients/placeholders seeded per look.
- **Fonts**: no `next/font/*` (avoids network fetch at build); system font stack only.

## PWA notes

- `app/manifest.ts` serves `/manifest.webmanifest` (name “Paparazzi Commerce”, `display: standalone`, `theme_color: #111111`).
- `public/icon.svg` is the app icon (original camera glyph, tiny).
- PWA meta in `app/layout.tsx`: `appleWebApp.capable`, viewport `width=device-width`.
- **Service worker intentionally omitted for now** — add Workbox/next-pwa in phase 2 when offline/caching strategy is decided.

## Styling

CSS Modules only — no tailwind, no component libraries. Mobile-first, 360px baseline.

## Run

From the repo root:

```bash
pnpm --filter @paparazzi/web build
pnpm --filter @paparazzi/web dev
```
