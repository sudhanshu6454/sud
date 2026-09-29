import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DemoBadge from '../../../components/DemoBadge';
import Disclosure from '../../../components/Disclosure';
import MatchBadge from '../../../components/MatchBadge';
import MerchantCta from '../../../components/MerchantCta';
import SaveButton from '../../../components/SaveButton';
import { getLook } from '../../../lib/catalogue';
import { formatMoney, freshnessLabel } from '../../../lib/format';
import { itemHref } from '../../../lib/saved';
import { siteName } from '../../../lib/site';
import styles from './page.module.css';

interface Params {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { value: look } = await getLook(params.id);
  return { title: look ? `${look.title} · ${siteName()}` : siteName() };
}

export default async function LookDetailPage({ params }: Params) {
  const { value: look, demo } = await getLook(params.id);
  if (!look) notFound();

  const [from, to] = look.gradientSeed;

  return (
    <div>
      <div className={styles.hero} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
        {look.coverUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- remote hosts vary per deployment */
          <img src={look.coverUrl} alt={look.title} className={styles.cover} />
        ) : (
          <span className={styles.srOnly}>Placeholder artwork for {look.title}</span>
        )}
        {look.sponsored && <span className={styles.sponsored}>Sponsored</span>}
      </div>

      {demo && <DemoBadge />}

      {look.sourcePage && <p className={styles.kicker}>Spotted on {look.sourcePage}</p>}
      <h1 className={styles.title}>{look.title}</h1>
      {look.sourcePage ? (
        <p className={styles.attr}>
          Source-page attribution: <strong>{look.sourcePage}</strong>
        </p>
      ) : (
        <p className={styles.attr}>Source page not recorded for this look.</p>
      )}

      <div className={styles.disclosureWrap}>
        <Disclosure />
      </div>

      <h2 className={styles.sectionTitle}>Shop this look</h2>

      {look.items.length === 0 ? (
        <p className={styles.emptyItems}>No products have been matched to this look yet.</p>
      ) : (
        <ul className={styles.productList}>
          {look.items.map((item) => (
            <li key={item.id} className={styles.productCard}>
              <div className={styles.productTop}>
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
              <Link href={itemHref(look.id, item.id)} className={styles.productName}>
                {item.brand} — {item.model}
              </Link>
              {item.available && item.price_minor !== null && item.currency ? (
                <>
                  <p className={styles.priceRow}>
                    <span className={styles.price}>{formatMoney(item.price_minor, item.currency)}</span>
                    {item.merchant && <span className={styles.merchant}>at {item.merchant}</span>}
                  </p>
                  {item.freshness && <p className={styles.freshness}>{freshnessLabel(item.freshness)}</p>}
                </>
              ) : null}
              <MerchantCta linkUrl={item.linkUrl} available={item.available} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
