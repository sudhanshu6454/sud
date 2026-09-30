import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DemoBadge from '@/components/DemoBadge';
import { CommercialLabel } from '@/components/shop/CommercialLabel';
import { Pager } from '@/components/shop/Pager';
import { QrSvg } from '@/components/shop/QrSvg';
import { ShareButton } from '@/components/shop/ShareButton';
import { SpottedGrid } from '@/components/shop/SpottedGrid';
import { CatalogueUnavailableError } from '@/lib/catalogue';
import { getStorefront } from '@/lib/public-catalogue';
import { celebrityPageMetadata } from '@/lib/seo';
import { siteUrl } from '@/lib/site';
import { CELEBRITY_WEB } from '@/lib/site-copy';
import { pageParam, pageTotal, platformLabel } from '@/lib/spotted';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

const STOREFRONT_DESCRIPTION = 'The looks this page posted, piece by piece, on Afflino. This page has affiliate links.';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const sf = await getStorefront(params.slug, pageParam(searchParams.p));
  // An outage is never a 404 for a page that may exist: the error state.
  if (sf.kind === 'outage') throw new CatalogueUnavailableError();
  if (sf.kind !== 'ok') notFound();
  // Treated as a celebrity page (it lists their looks): noindex unless CELEBRITY_INDEXING is on too.
  return celebrityPageMetadata(`/s/${sf.value.slug}`, sf.value.name, STOREFRONT_DESCRIPTION, { demo: sf.demo });
}

/**
 * A storefront (/s/<slug>): the link-in-bio page of one in-house Facebook
 * or Instagram page — the page's name and bio, then its latest public looks
 * (the same rights gate as the feed; on phones two compact columns, so a
 * visitor finds the post they came from), then share and a QR code of this
 * address. Only live storefronts of approved, owner-operated pages whose
 * name and bio name nobody exist (404 otherwise, inside this layout:
 * not-found.tsx).
 */
export default async function StorefrontPage({ params, searchParams }: Props) {
  const page = pageParam(searchParams.p);
  const sf = await getStorefront(params.slug, page);
  // An outage is never a 404 for a page that may exist: the error state.
  if (sf.kind === 'outage') throw new CatalogueUnavailableError();
  if (sf.kind !== 'ok') notFound();
  const s = sf.value;
  const url = `${siteUrl()}/s/${s.slug}`;
  const platform = platformLabel(s.platform);
  const pages = pageTotal(s.looks);
  return (
    <>
      {s.looks.items.length > 0 && s.commercialLabel ? <CommercialLabel text={s.commercialLabel} /> : null}
      <header className={styles.head}>
        <div className={styles.identity}>
          <p className={styles.eyebrow}>
            {platform ? `Our ${platform} page` : 'Our page'}
            {sf.demo ? <DemoBadge className={styles.badge} /> : null}
          </p>
          <h1 className={styles.title}>{s.name}</h1>
          {s.bio ? <p className={styles.bio}>{s.bio}</p> : null}
          {s.pageUrl ? (
            <p className={styles.pageLink}>
              <a href={s.pageUrl} rel="noopener nofollow">
                Open on {platform ?? 'the platform'}
                <span aria-hidden="true">{'\u00a0'}→</span>
              </a>
            </p>
          ) : null}
        </div>
      </header>
      <h2 className="sr-only">{CELEBRITY_WEB.storefrontLooks}</h2>
      <SpottedGrid
        looks={s.looks.items}
        label={`Looks from ${s.name}`}
        empty={{ title: CELEBRITY_WEB.storefrontEmpty, body: CELEBRITY_WEB.feedEmpty, action: { label: 'See every look', href: '/shop' } }}
        storefront
      />
      <Pager page={Math.min(page, pages)} pages={pages} href={(p) => `/s/${s.slug}${p > 1 ? `?p=${p}` : ''}`} />
      <section className={styles.share} aria-label={CELEBRITY_WEB.share}>
        <ShareButton url={url} title={s.name} />
        <details className={styles.qr}>
          <summary className={styles.qrSummary}>
            <span className={styles.qrClosed}>{CELEBRITY_WEB.qrShow}</span>
            <span className={styles.qrOpen}>{CELEBRITY_WEB.qrHide}</span>
          </summary>
          <div className={styles.qrBody}>
            <QrSvg text={url} label={CELEBRITY_WEB.qrLabel} />
            <p className={styles.qrUrl}>{url.replace(/^https?:\/\//, '')}</p>
          </div>
        </details>
      </section>
    </>
  );
}
