import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DemoBadge from '@/components/DemoBadge';
import { BackBar } from '@/components/shop/BackBar';
import { CelebrityCredit } from '@/components/shop/CelebrityCredit';
import { CommercialLabel } from '@/components/shop/CommercialLabel';
import { Pager } from '@/components/shop/Pager';
import { SpottedGrid } from '@/components/shop/SpottedGrid';
import { WithdrawnNotice } from '@/components/shop/WithdrawnNotice';
import detail from '@/components/shop/detail.module.css';
import styles from '@/components/shop/SpottedPage.module.css';
import { PageHeader } from '@/components/ui';
import { CatalogueUnavailableError } from '@/lib/catalogue';
import { getCelebrityHub } from '@/lib/public-catalogue';
import { celebrityPageMetadata } from '@/lib/seo';
import { CELEBRITY_WEB } from '@/lib/site-copy';
import { pageParam, pageTotal } from '@/lib/spotted';

export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const hub = await getCelebrityHub(params.slug, pageParam(searchParams.p));
  if (hub.kind === 'gone') return { title: 'Withdrawn', robots: { index: false, follow: false } };
  // An outage is never a 404 for a page that may exist: the error state.
  if (hub.kind === 'outage') throw new CatalogueUnavailableError();
  if (hub.kind !== 'ok') notFound();
  return celebrityPageMetadata(`/c/${hub.value.celebrity.slug}`, hub.value.celebrity.name, hub.value.nonEndorsement, { demo: hub.demo });
}

/**
 * A celebrity's hub (/c/<slug>): their public looks, newest first — only
 * while their rights allow the name and at least one look is public (the
 * API answers 404 otherwise: nothing about an unreviewed or blocked
 * celebrity exists here); a takedown answers 410 (the middleware) and shows
 * only the withdrawn notice. The commercial label at the top (when a listed
 * look carries products). The heading never names the person (a heading is
 * set far larger than body text): the name is in the credit line under it,
 * one sentence with the non-endorsement line, at body size.
 */
export default async function CelebrityHubPage({ params, searchParams }: Props) {
  const page = pageParam(searchParams.p);
  const hub = await getCelebrityHub(params.slug, page);
  if (hub.kind === 'gone') return <WithdrawnNotice />;
  // An outage is never a 404 for a page that may exist: the error state.
  if (hub.kind === 'outage') throw new CatalogueUnavailableError();
  if (hub.kind !== 'ok') notFound();
  const { celebrity, looks } = hub.value;
  const pages = pageTotal(looks);
  return (
    <>
      {hub.value.commercialLabel ? <CommercialLabel text={hub.value.commercialLabel} /> : null}
      <BackBar href="/shop" label={CELEBRITY_WEB.feedTitle} />
      <PageHeader
        className={styles.header}
        eyebrow={
          <>
            <span className={detail.crumbDesk}>
              <Link href="/shop" className={detail.crumb}>
                {CELEBRITY_WEB.feedTitle}
              </Link>
              {' · '}
            </span>
            {`${looks.total} ${looks.total === 1 ? 'look' : 'looks'}`}
          </>
        }
        title={CELEBRITY_WEB.hubTitle}
        description={<CelebrityCredit celebrity={celebrity} nonEndorsement={hub.value.nonEndorsement} link={false} as="span" className={styles.hubLine} />}
        actions={hub.demo ? <DemoBadge className={styles.badge} /> : undefined}
      />
      <h2 className="sr-only">{CELEBRITY_WEB.hubLooks}</h2>
      <SpottedGrid looks={looks.items} label={`Looks of ${celebrity.name}`} empty={{ title: CELEBRITY_WEB.feedEmptyTitle, body: CELEBRITY_WEB.feedEmpty }} />
      <Pager page={Math.min(page, pages)} pages={pages} href={(p) => `/c/${celebrity.slug}${p > 1 ? `?p=${p}` : ''}`} />
    </>
  );
}
