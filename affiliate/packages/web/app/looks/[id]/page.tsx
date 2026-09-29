import Link from 'next/link';
import { notFound } from 'next/navigation';
import Disclosure from '../../../components/Disclosure';
import SaveButton from '../../../components/SaveButton';
import { getLook, getProductsForLook } from '../../../lib/mock-data';
import { formatINR, timeAgo } from '../../../lib/format';
import styles from './page.module.css';

interface Params {
  params: { id: string };
}

/*
 * NOTE: outbound merchant links are STUBBED — CTA hrefs point to '#'.
 * In phase 2 these become signed redirect URLs from the redirect service
 * (click id, attribution, sponsor flags).
 */
const MERCHANT_STUB_HREF = '#';

export default function LookDetailPage({ params }: Params) {
  const look = getLook(params.id);
  if (!look) notFound();

  const products = getProductsForLook(look);
  const [from, to] = look.gradientSeed;

  return (
    <div>
      <div
        className={styles.hero}
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        role="img"
        aria-label={`Placeholder artwork for ${look.title}`}
      >
        {look.sponsored && <span className={styles.sponsored}>Sponsored</span>}
      </div>

      <p className={styles.kicker}>Spotted on {look.sourcePage}</p>
      <h1 className={styles.title}>{look.title}</h1>
      <p className={styles.attr}>
        Source-page attribution: <strong>{look.sourcePage}</strong>
      </p>

      <div className={styles.disclosureWrap}>
        <Disclosure />
      </div>

      <h2 className={styles.sectionTitle}>Shop this look</h2>

      <ul className={styles.productList}>
        {products.map((p) => (
          <li key={p.id} className={styles.productCard}>
            <div className={styles.productTop}>
              <span
                className={
                  p.match === 'exact' ? styles.badgeExact : styles.badgeSimilar
                }
              >
                {p.match === 'exact' ? 'Exact item' : 'Similar style'}
              </span>
              <SaveButton productId={p.id} />
            </div>
            <Link href={`/products/${p.id}`} className={styles.productName}>
              {p.brand} — {p.model}
            </Link>
            <p className={styles.priceRow}>
              <span className={styles.price}>{formatINR(p.price_minor)}</span>
              <span className={styles.merchant}>at {p.merchant}</span>
            </p>
            <p className={styles.freshness}>
              Price updated {timeAgo(p.freshness)} — check current price at
              merchant
            </p>
            <a
              href={MERCHANT_STUB_HREF}
              className={styles.cta}
              title="Outbound merchant link — stubbed"
            >
              View at merchant
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
