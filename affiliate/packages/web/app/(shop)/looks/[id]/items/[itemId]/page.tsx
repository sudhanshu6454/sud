import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DemoBadge from '@/components/DemoBadge';
import Disclosure from '@/components/Disclosure';
import MatchBadge from '@/components/MatchBadge';
import MerchantCta from '@/components/MerchantCta';
import SaveButton from '@/components/SaveButton';
import { getLook } from '@/lib/catalogue';
import { formatMoney, freshnessLabel, stockLabel } from '@/lib/format';
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
  const { value: look } = await getLook(params.id);
  const item = look?.items.find((i) => i.id === params.itemId);
  // The root layout's title template appends the site name.
  return item ? { title: `${item.brand} — ${item.model}` } : {};
}

export default async function ItemDetailPage({ params }: Params) {
  const { value: look, demo } = await getLook(params.id);
  if (!look) notFound();
  const item = look.items.find((i) => i.id === params.itemId);
  if (!item) notFound();

  const [from, to] = look.gradientSeed;
  const facts: string[] = [];
  if (item.variant.size) facts.push(`Size ${item.variant.size}`);
  if (item.variant.colour) facts.push(item.variant.colour);
  if (item.variant.sku) facts.push(`SKU ${item.variant.sku}`);

  return (
    <div>
      <Link href={`/looks/${encodeURIComponent(look.id)}`} className={styles.back}>
        ← {look.title}
      </Link>

      <div className={styles.media} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
        {look.coverUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- remote hosts vary per deployment */
          <img src={look.coverUrl} alt={look.title} className={styles.cover} />
        ) : null}
      </div>

      {demo && <DemoBadge />}

      <div className={styles.topRow}>
        <MatchBadge match={item.match} />
        <SaveButton
          lookId={look.id}
          itemId={item.id}
          lookTitle={look.title}
          brand={item.brand}
          model={item.model}
          merchant={item.merchant}
          price_minor={item.price_minor}
          currency={item.currency}
        />
      </div>

      <h1 className={styles.title}>
        {item.brand} — {item.model}
      </h1>

      {item.available && item.price_minor !== null && item.currency ? (
        <p className={styles.price}>{formatMoney(item.price_minor, item.currency)}</p>
      ) : (
        <p className={styles.unavailableNote}>Not available right now — no live offer for this item.</p>
      )}

      {item.available && (
        <div className={styles.block}>
          <h2 className={styles.label}>Merchant</h2>
          <div className={styles.merchantRow}>
            <span className={styles.merchantName}>{item.merchant}</span>
            {item.stock && (
              <span className={item.stock === 'out_of_stock' ? styles.stockOut : styles.stockIn}>
                {stockLabel(item.stock)}
              </span>
            )}
          </div>
          {item.freshness && <p className={styles.freshness}>{freshnessLabel(item.freshness)}</p>}
        </div>
      )}

      <div className={styles.block}>
        <h2 className={styles.label}>Variant</h2>
        <p className={styles.facts}>{facts.length > 0 ? facts.join(' · ') : 'Single variant'}</p>
        {item.evidence && <p className={styles.evidence}>Match evidence: {item.evidence}</p>}
      </div>

      <MerchantCta linkUrl={item.linkUrl} available={item.available} label="Shop at merchant" size="large" />

      <p className={styles.merchantNote}>Payment, delivery and returns are handled by the merchant.</p>

      <div className={styles.disclosureWrap}>
        <Disclosure />
      </div>
    </div>
  );
}
