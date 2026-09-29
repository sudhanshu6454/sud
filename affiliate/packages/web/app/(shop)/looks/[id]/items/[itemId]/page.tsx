import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DemoBadge from '@/components/DemoBadge';
import Disclosure from '@/components/Disclosure';
import MatchBadge from '@/components/MatchBadge';
import MerchantCta from '@/components/MerchantCta';
import SaveButton from '@/components/SaveButton';
import { BackBar } from '@/components/shop/BackBar';
import { Cover } from '@/components/shop/Cover';
import { Facts } from '@/components/shop/Facts';
import {
  displayCategory,
  hasPrice,
  itemName,
  matchTag,
  offerCopy,
  shownStock,
  stockIsOut,
  storablePrice,
  variantFacts,
} from '@/components/shop/model';
import shared from '@/components/shop/detail.module.css';
import { PageHeader, Tag } from '@/components/ui';
import { getLook, lookOrMiss } from '@/lib/catalogue';
import { shopDetailMetadata } from '@/lib/seo';
import { formatMoney, freshnessLabel, priceAsOfLabel, stockLabel } from '@/lib/format';
import styles from './page.module.css';

interface Params {
  params: { id: string; itemId: string };
}

export const dynamic = 'force-dynamic';

/**
 * Product detail. Product ids are look_items ids, which only resolve
 * through their look (GET /v1/looks/:id), hence the nested route.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  // An outage throws (the shop's error state), never a 404 for a look that exists.
  const result = await getLook(params.id);
  const look = lookOrMiss(result);
  const item = look?.items.find((i) => i.id === params.itemId);
  // A miss is a 404 here too. No loading.tsx on this route: a Suspense
  // boundary would start the stream before notFound(), turning it into 200.
  if (!look || !item) notFound();
  // The root layout's title template appends the site name; canonical and
  // og:url are the item's own path; items of demo and TEST-labelled looks
  // are noindex, nofollow (lib/seo.ts).
  return shopDetailMetadata(
    `/looks/${encodeURIComponent(look.id)}/items/${encodeURIComponent(item.id)}`,
    itemName(item),
    { demo: result.demo, lookTitle: look.title },
  );
}

/**
 * Drawn like an offer detail: header (the look as crumb, product name), the
 * look's cover on the left; on the right the match tag, price (36px / 800),
 * merchant, stock and freshness, the disclosure panel, "View at merchant →"
 * with Save (a sticky footer on phones, as 1e's "Copy link →" bar), the
 * merchant note and the variant facts. Live GET /v1/looks/:id; TEST demo
 * data + badge on fallback. An Amazon.in offer (offerCopy): "Buy on
 * Amazon.in", "Amazon.in Price" with "as of … IST" and Amazon's disclaimer
 * and attribution line — or "See price on Amazon.in" when the API sent no
 * price — and the Associate statement in the disclosure panel.
 */
export default async function ItemDetailPage({ params }: Params) {
  const result = await getLook(params.id);
  const look = lookOrMiss(result);
  const { demo } = result;
  if (!look) notFound();
  const item = look.items.find((i) => i.id === params.itemId);
  if (!item) notFound();

  const name = itemName(item);
  const variant = variantFacts(item.variant);
  const priced = hasPrice(item);
  const copy = offerCopy(item);
  const stock = shownStock(item);
  const asOf = priced ? priceAsOfLabel(item.priceAsOf) : null;
  const saved = storablePrice(item);
  const lookHref = `/looks/${encodeURIComponent(look.id)}`;

  const facts: Array<[string, React.ReactNode]> = [];
  if (item.available) {
    facts.push(['Merchant', item.merchant ?? 'Not recorded']);
    if (stock) facts.push(['Stock', stockLabel(stock)]);
  }
  facts.push(['Variant', variant.length > 0 ? variant.join(' · ') : 'Single variant']);
  if (item.variant.sku) facts.push(['Merchant SKU', <span key="sku" className={styles.mono}>{item.variant.sku}</span>]);
  facts.push(['Match', matchTag(item.match).label]);
  if (item.evidence) facts.push(['Match evidence', item.evidence]);
  facts.push(['Category', displayCategory(item.category)]);
  facts.push(['From the look', <Link key="look" href={lookHref}>{look.title}</Link>]);

  return (
    <>
      <BackBar href={lookHref} label={look.title} title="Product" />
      <PageHeader
        className={shared.header}
        eyebrow={
          <>
            <span className={shared.crumbDesk}>
              <Link href={lookHref} className={shared.crumb}>
                {look.title}
              </Link>
              {' · '}
            </span>
            {displayCategory(item.category)}
          </>
        }
        title={name}
        description={
          look.sourcePage ? (
            <>
              From a look spotted on <strong>{look.sourcePage}</strong>
            </>
          ) : undefined
        }
        actions={demo ? <DemoBadge className={shared.badge} /> : undefined}
      />

      <div className={`${shared.split} ${styles.split}`}>
        <div className={shared.media}>
          <div className={`${shared.cover} ${styles.cover}`}>
            <Cover look={look} alt={`${look.title}, the look this product was spotted in`} fit="natural" loading="eager" />
          </div>
        </div>

        <section className={shared.body} aria-labelledby="item-offer">
          <h2 id="item-offer" className="sr-only">
            Offer
          </h2>
          <div className={styles.tags}>
            <MatchBadge match={item.match} />
            {look.sponsored ? <Tag variant="accent">Sponsored look</Tag> : null}
          </div>

          {priced ? (
            <div className={styles.offer}>
              <div className={styles.priceLabel}>{copy.priceLabel}</div>
              <div className={styles.price}>{formatMoney(item.price_minor, item.currency)}</div>
              <p className={styles.merchant}>
                {item.merchant ? (
                  <>
                    at <strong>{item.merchant}</strong>
                  </>
                ) : null}
                {item.merchant && stock ? ' · ' : null}
                {stock ? <span className={stockIsOut(stock) ? styles.out : undefined}>{stockLabel(stock)}</span> : null}
              </p>
              {asOf ? (
                <p className={shared.note}>
                  ({asOf}) {copy.priceDisclaimer}
                </p>
              ) : item.freshness ? (
                <p className={shared.note}>{freshnessLabel(item.freshness)}</p>
              ) : null}
            </div>
          ) : item.available ? (
            <div className={styles.offer}>
              <div className={styles.priceLabel}>{copy.priceLabel}</div>
              <p className={styles.noPrice}>{copy.noPriceLabel}</p>
            </div>
          ) : (
            <p className={styles.unavailableNote}>This product has no live offer at the moment, so there is no price. Save it and check back later.</p>
          )}

          <Disclosure lines={copy.disclosures} />

          <div className={styles.actions}>
            <MerchantCta linkUrl={item.linkUrl} available={item.available} label={copy.ctaLabel} itemName={name} touch />
            <SaveButton
              block
              lookId={look.id}
              itemId={item.id}
              lookTitle={look.title}
              brand={item.brand}
              model={item.model}
              merchant={item.merchant}
              price_minor={saved.price_minor}
              priceNotStored={saved.priceNotStored}
              currency={item.currency}
              className={styles.save}
            />
          </div>

          <p className={shared.note}>{copy.purchaseNote}</p>
          {copy.contentAttribution ? <p className={shared.note}>{copy.contentAttribution}</p> : null}

          <Facts label="Product details" items={facts} />
        </section>
      </div>
    </>
  );
}
