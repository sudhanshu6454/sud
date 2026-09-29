import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DemoBadge from '@/components/DemoBadge';
import Disclosure from '@/components/Disclosure';
import { BackBar } from '@/components/shop/BackBar';
import { Cover } from '@/components/shop/Cover';
import { Facts } from '@/components/shop/Facts';
import { ItemRow } from '@/components/shop/ItemRow';
import { productCount, publishedLabel } from '@/components/shop/model';
import styles from '@/components/shop/detail.module.css';
import { EmptyState, Eyebrow, PageHeader, Tag } from '@/components/ui';
import { getLook, lookOrMiss } from '@/lib/catalogue';
import { shopDetailMetadata } from '@/lib/seo';

interface Params {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  // An outage throws (the shop's error state), never a 404 for a look that exists.
  const result = await getLook(params.id);
  const look = lookOrMiss(result);
  // A miss is a 404 here too. No loading.tsx on this route: a Suspense
  // boundary would start the stream before notFound(), turning it into 200.
  if (!look) notFound();
  // The root layout's title template appends the site name; canonical and
  // og:url are the look's own path; demo and TEST-labelled looks are
  // noindex, nofollow (lib/seo.ts).
  return shopDetailMetadata(`/looks/${encodeURIComponent(look.id)}`, look.title, {
    demo: result.demo,
    lookTitle: look.title,
  });
}

/**
 * Look detail, drawn like an offer detail: header (crumb · category, title,
 * source-page attribution, Sponsored tag), then the cover and the look's
 * facts beside "Shop this look" — the disclosure panel and one row per
 * product with its match tag, price, merchant, freshness, stock and the
 * tracked "View at merchant →" link (or its disabled / unavailable states).
 * Live GET /v1/looks/:id?placement_id=; TEST demo data + badge on fallback.
 */
export default async function LookDetailPage({ params }: Params) {
  const result = await getLook(params.id);
  const look = lookOrMiss(result);
  const { demo } = result;
  if (!look) notFound();

  const published = publishedLabel(look.publishedAt);
  const count = productCount(look.items.length);

  return (
    <>
      <BackBar href="/shop" label="Shop the looks" title="Look" />
      <PageHeader
        className={styles.header}
        eyebrow={
          <>
            <span className={styles.crumbDesk}>
              <Link href="/shop" className={styles.crumb}>
                Shop the looks
              </Link>
              {look.category ? ' · ' : null}
            </span>
            {look.category ?? <span className={styles.crumbDesk}>Look</span>}
          </>
        }
        title={look.title}
        description={
          look.sourcePage ? (
            <>
              Spotted on <strong>{look.sourcePage}</strong>
            </>
          ) : (
            'Source page not recorded for this look.'
          )
        }
        actions={
          look.sponsored || demo ? (
            <span className={styles.headerActions}>
              {look.sponsored ? <Tag variant="accent">Sponsored</Tag> : null}
              {demo ? <DemoBadge className={styles.badge} /> : null}
            </span>
          ) : undefined
        }
      />

      <div className={styles.split}>
        <div className={styles.media}>
          <div className={styles.cover}>
            <Cover look={look} alt={look.title} fit="natural" loading="eager" />
          </div>
          <div className={styles.aside}>
            <Facts
              label="About this look"
              items={[
                ['Source page', look.sourcePage ?? 'Not recorded'],
                ['Category', look.category ?? 'Not set'],
                ['Products', count],
                ...(published ? ([['Published', published.replace(/^Published /, '')]] as [string, string][]) : []),
                ['Sponsored', look.sponsored ? 'Yes' : 'No'],
              ]}
            />
          </div>
        </div>

        <section className={styles.body} aria-labelledby="look-products">
          <div className={styles.sectionHead}>
            <h2 id="look-products" className={styles.sectionTitle}>
              Shop this look
            </h2>
            <Eyebrow as="span">{count}</Eyebrow>
          </div>
          <Disclosure />
          {look.items.length === 0 ? (
            <div className={styles.empty}>
              <EmptyState title="No products yet." action={{ label: 'Browse the shop', href: '/shop' }}>
                No products have been matched to this look yet.
              </EmptyState>
            </div>
          ) : (
            <ul className={styles.list}>
              {look.items.map((item) => (
                <ItemRow key={item.id} look={look} item={item} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
