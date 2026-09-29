'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import Disclosure from '../../../components/Disclosure';
import { getProduct, stockLabel } from '../../../lib/mock-data';
import { formatINR, timeAgo } from '../../../lib/format';
import styles from './page.module.css';

// Size/variant selector — STUBBED (visual only, no live stock-level data yet).
const SIZES = ['S', 'M', 'L', 'XL'];

/*
 * NOTE: outbound merchant links are STUBBED — CTA href is '#'.
 * In phase 2 this becomes a signed redirect URL from the redirect service
 * (click id, attribution, sponsor flags).
 */
const MERCHANT_STUB_HREF = '#';

export default function ProductDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [size, setSize] = useState<string | null>(null);

  const product = getProduct(params.id);
  if (!product) notFound();

  return (
    <div>
      <div className={styles.media} aria-hidden="true" />

      <span
        className={
          product.match === 'exact' ? styles.badgeExact : styles.badgeSimilar
        }
      >
        {product.match === 'exact' ? 'Exact item' : 'Similar style'}
      </span>

      <h1 className={styles.title}>
        {product.brand} — {product.model}
      </h1>

      <p className={styles.price}>{formatINR(product.price_minor)}</p>

      <div className={styles.block}>
        <h2 className={styles.label}>Merchant</h2>
        <div className={styles.merchantRow}>
          <span className={styles.merchantName}>{product.merchant}</span>
          <span
            className={
              product.stock === 'out_of_stock'
                ? styles.stockOut
                : styles.stockIn
            }
          >
            {stockLabel(product.stock)}
          </span>
        </div>
        <p className={styles.freshness}>
          Price checked {timeAgo(product.freshness)} — final price at merchant.
        </p>
      </div>

      <div className={styles.block}>
        <h2 className={styles.label}>Size</h2>
        <div className={styles.sizeRow} role="group" aria-label="Size (stub)">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.size} ${size === s ? styles.sizeActive : ''}`}
              onClick={() => setSize(s)}
              aria-pressed={size === s}
              title="Size selector — stub, no live stock data"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <a
        href={MERCHANT_STUB_HREF}
        className={styles.cta}
        title="Outbound merchant link — stubbed"
      >
        Shop at merchant
      </a>

      <p className={styles.merchantNote}>
        Payment, delivery and returns are handled by the merchant.
      </p>

      <div className={styles.disclosureWrap}>
        <Disclosure />
      </div>
    </div>
  );
}
