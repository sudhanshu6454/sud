import type { Metadata } from 'next';
import DemoBadge from '@/components/DemoBadge';
import LookGrid from '@/components/LookGrid';
import { CommercialLabel } from '@/components/shop/CommercialLabel';
import { Pager } from '@/components/shop/Pager';
import { SpottedFilters } from '@/components/shop/SpottedFilters';
import { SpottedGrid } from '@/components/shop/SpottedGrid';
import { TrendingRow } from '@/components/shop/TrendingRow';
import styles from '@/components/shop/SpottedPage.module.css';
import { PageHeader } from '@/components/ui';
import { listLooks } from '@/lib/catalogue';
import { getSpotted, getTrending } from '@/lib/public-catalogue';
import { shopMetadata } from '@/lib/seo';
import { CELEBRITY_WEB } from '@/lib/site-copy';
import { feedQuery, pageParam, pageTotal, slugParam } from '@/lib/spotted';

// Rendered per request; the API answers are cached by the fetches
// (30 s for the public celebrity reads with their cache tags, 60 s for the
// catalogue), so the page is never a build-time snapshot.
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const { value } = await getSpotted({});
  return shopMetadata({ celebrityContent: value.items.length > 0 });
}

/**
 * The shop's home is the Spotted feed: celebrity moments from the in-house
 * pages, newest first (the public read API, which applies the rights gate),
 * with the trending row (clicks over 7 days, the unfiltered first page only),
 * filters by celebrity and by page, and the pager; then the rest of the
 * catalogue ("More looks": GET /v1/looks, which never carries celebrity
 * looks). Both fall back to TEST demo data with a badge when their API
 * cannot be reached.
 */
export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const celebrity = slugParam(searchParams.celebrity);
  const from = slugParam(searchParams.from);
  const page = pageParam(searchParams.p);
  const filtered = !!celebrity || !!from;
  const [spotted, trending, catalogue] = await Promise.all([
    getSpotted({ celebrity, from, page }),
    filtered || page > 1 ? Promise.resolve({ value: [], demo: false }) : getTrending(),
    listLooks(),
  ]);
  const feed = spotted.value;
  const pages = pageTotal(feed);
  const shownCount = `${feed.total} ${feed.total === 1 ? 'look' : 'looks'}`;
  return (
    <>
      {feed.items.length > 0 && feed.commercialLabel ? <CommercialLabel text={feed.commercialLabel} /> : null}
      <PageHeader
        className={styles.header}
        eyebrow={filtered ? `${CELEBRITY_WEB.feedTitle} · ${shownCount}` : 'Afflino'}
        title={CELEBRITY_WEB.feedTitle}
        description={CELEBRITY_WEB.feedIntro}
        actions={spotted.demo || trending.demo ? <DemoBadge className={styles.badge} /> : undefined}
      />
      <TrendingRow looks={trending.value} />
      <SpottedFilters celebrities={feed.facets.celebrities} pages={feed.facets.storefronts} celebrity={celebrity} from={from} />
      <h2 className="sr-only">{filtered ? 'Looks matching the filters' : 'Latest looks'}</h2>
      <SpottedGrid
        looks={feed.items}
        label="Spotted looks"
        empty={
          filtered
            ? { title: 'No looks match.', body: 'Nothing is public for this filter right now.', action: { label: 'Show every look', href: '/shop' } }
            : { title: CELEBRITY_WEB.feedEmptyTitle, body: CELEBRITY_WEB.feedEmpty }
        }
      />
      <Pager page={Math.min(page, pages)} pages={pages} href={(p) => `/shop${feedQuery({ celebrity, from, p })}`} />
      {catalogue.demo || catalogue.value.length > 0 ? (
        // The rest of the catalogue; hidden while the live catalogue has no look of its own.
        <section className={styles.more} aria-label={CELEBRITY_WEB.moreLooksTitle}>
          <LookGrid looks={catalogue.value} demo={catalogue.demo} sectionEyebrow={CELEBRITY_WEB.moreLooksTitle} />
        </section>
      ) : null}
    </>
  );
}
