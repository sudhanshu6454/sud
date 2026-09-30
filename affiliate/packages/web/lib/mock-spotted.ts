/**
 * TEST-LABELLED demo celebrity looks for the Spotted feed, a hub, a look page
 * and a storefront, used only when the public read API cannot be reached.
 * The people are fictional ("Demo Star One", "Demo Star Two"); brands,
 * merchants and pages are "Demo …"; there is no image (the gradient
 * placeholder stands in) and no link (every call to action is the disabled
 * "Link not available yet"), exactly like a live item without a minted link.
 * No real celebrity, merchant or library data is ever here. A page that
 * renders this data renders <DemoBadge /> too.
 *
 * The wording is the API's (packages/shared/src/celebrity.ts CELEBRITY_COPY),
 * restated here for the demo only; the live pages always print what the API
 * sends.
 */
import { gradientSeedFor } from './types';
import type { CelebrityHub, CelebrityLook, OutfitPiece, PieceProduct, SpottedCard, SpottedFeed, StorefrontPage } from './spotted';

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const dateOnly = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const COMMERCIAL = 'Ad · This page has affiliate links';
const nonEndorsement = (name: string) => `${name} is not affiliated with Afflino and has not endorsed any product on this page.`;
const similarLine = (name: string) => `Similar style. ${name} did not wear or endorse this product.`;

const ONE = { name: 'Demo Star One', slug: 'demo-star-one' };
const TWO = { name: 'Demo Star Two', slug: 'demo-star-two' };
const PAGE = { slug: 'demo-afflino-instagram', name: 'Demo Instagram' };

function product(
  id: string,
  match: 'exact' | 'similar',
  brand: string,
  model: string,
  price: number | null,
  merchant: string,
  who: string,
  extra: Partial<PieceProduct> = {},
): PieceProduct {
  return {
    id,
    brand,
    model,
    category: 'Clothing',
    variant: { size: null, colour: null, sku: null },
    match,
    evidence: null,
    available: true,
    merchant,
    price_minor: price,
    currency: 'INR',
    freshness: null,
    priceAsOf: null,
    stock: 'in_stock',
    connector: null,
    disclosure: null,
    linkUrl: null,
    wordingLabel: match === 'exact' ? 'The same item' : 'Similar styles',
    wordingDetail: match === 'exact' ? "Identified by Afflino's editors from the evidence on record." : similarLine(who),
    ...extra,
  };
}

const PIECES_ONE: OutfitPiece[] = [
  {
    id: 'demo-piece-shirt',
    label: 'The shirt',
    category: 'shirt',
    position: 0,
    hotspot: null,
    productsShown: true,
    exact: product('demo-item-1', 'exact', 'Demo Label', 'Linen Camp-Collar Shirt', 349900, 'Demo Merchant One', ONE.name),
    similarHeading: 'Similar styles',
    similar: [
      product('demo-item-2', 'similar', 'Demo Basics', 'Relaxed Linen-Blend Shirt', 129900, 'Demo Merchant Two', ONE.name),
      product('demo-item-3', 'similar', 'Demo Studio', 'Short-Sleeve Resort Shirt', 99900, 'Demo Merchant One', ONE.name),
    ],
  },
  {
    id: 'demo-piece-trousers',
    label: 'The trousers',
    category: 'trousers',
    position: 1,
    hotspot: null,
    productsShown: true,
    exact: null,
    similarHeading: 'Similar styles',
    similar: [
      product('demo-item-4', 'similar', 'Demo Tailor', 'Pleated Wide-Leg Trousers', 219900, 'Demo Merchant Two', ONE.name),
      product('demo-item-5', 'similar', 'Demo Basics', 'Drawstring Cotton Trousers', 89900, 'Demo Merchant One', ONE.name, { available: false, merchant: null, price_minor: null, stock: null }),
    ],
  },
  {
    id: 'demo-piece-eyewear',
    label: 'The sunglasses',
    category: 'eyewear',
    position: 2,
    hotspot: null,
    productsShown: true,
    exact: null,
    similarHeading: 'Similar styles',
    similar: [product('demo-item-6', 'similar', 'Demo Optics', 'Rounded Acetate Sunglasses', 159900, 'Demo Merchant One', ONE.name)],
  },
];

const LOOKS: CelebrityLook[] = [
  {
    id: 'demo-spotted-premiere',
    headline: 'Spotted at Demo Film Premiere',
    commercialLabel: COMMERCIAL,
    celebrity: ONE,
    nonEndorsement: nonEndorsement(ONE.name),
    moment: { event: 'Demo Film Premiere', place: 'Demo City', date: dateOnly(9) },
    image: null,
    platform: 'instagram',
    postPermalink: null,
    storefront: PAGE,
    display: { name: true, image: false, shoppable: true },
    disclosure: { sponsored: false, affiliateLinks: false, amazonAssociate: false },
    pieces: PIECES_ONE,
    publishedAt: iso(2),
    gradientSeed: gradientSeedFor('demo-spotted-premiere'),
  },
  {
    id: 'demo-spotted-airport',
    headline: 'Spotted at Demo Airport Arrival',
    // Name only, no products: no commercial label.
    commercialLabel: null,
    celebrity: TWO,
    nonEndorsement: nonEndorsement(TWO.name),
    moment: { event: 'Demo Airport Arrival', place: 'Demo City Airport', date: dateOnly(12) },
    image: null,
    platform: 'facebook',
    postPermalink: null,
    storefront: null,
    display: { name: true, image: false, shoppable: false },
    disclosure: { sponsored: false, affiliateLinks: false, amazonAssociate: false },
    pieces: [
      { id: 'demo-piece-bag', label: 'The bag', category: 'bag', position: 0, hotspot: null, productsShown: false, exact: null, similarHeading: 'Similar styles', similar: [] },
    ],
    publishedAt: iso(4),
    gradientSeed: gradientSeedFor('demo-spotted-airport'),
  },
];

function card(l: CelebrityLook): SpottedCard {
  return {
    id: l.id,
    headline: l.headline,
    celebrity: l.celebrity,
    nonEndorsement: l.nonEndorsement,
    moment: l.moment,
    imageUrl: null,
    platform: l.platform,
    storefront: l.storefront,
    pieces: l.pieces.length,
    shoppable: l.display.shoppable,
    publishedAt: l.publishedAt,
    gradientSeed: l.gradientSeed,
  };
}

function feed(looks: CelebrityLook[]): SpottedFeed {
  return {
    items: looks.map(card),
    page: 1,
    pageSize: 24,
    total: looks.length,
    facets: {
      celebrities: [
        { ...ONE, looks: 1 },
        { ...TWO, looks: 1 },
      ],
      storefronts: [{ ...PAGE, looks: 1 }],
    },
    commercialLabel: looks.some((l) => l.display.shoppable) ? COMMERCIAL : null,
  };
}

export function mockSpotted(filter: { celebrity?: string | null; from?: string | null } = {}): SpottedFeed {
  const looks = LOOKS.filter((l) => (!filter.celebrity || l.celebrity.slug === filter.celebrity) && (!filter.from || l.storefront?.slug === filter.from));
  return feed(looks);
}

export function mockTrending(): SpottedCard[] {
  return LOOKS.slice(0, 1).map(card);
}

export function mockCelebrityLook(id: string): CelebrityLook | null {
  return LOOKS.find((l) => l.id === id) ?? null;
}

export function mockHub(slug: string): CelebrityHub | null {
  const looks = LOOKS.filter((l) => l.celebrity.slug === slug);
  const first = looks[0];
  if (!first) return null;
  return { celebrity: first.celebrity, commercialLabel: looks.some((l) => l.display.shoppable) ? COMMERCIAL : null, nonEndorsement: first.nonEndorsement, looks: feed(looks) };
}

export function mockStorefront(slug: string): StorefrontPage | null {
  if (slug !== PAGE.slug) return null;
  return {
    slug: PAGE.slug,
    name: PAGE.name,
    bio: 'Demo in-house page: every look we post, piece by piece. TEST data.',
    platform: 'instagram',
    pageUrl: null,
    commercialLabel: COMMERCIAL,
    looks: feed(LOOKS.filter((l) => l.storefront?.slug === PAGE.slug)),
  };
}

/** Demo ids are not uuids (live look ids always are). */
export function isDemoSpottedId(id: string): boolean {
  return LOOKS.some((l) => l.id === id);
}
