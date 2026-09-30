import MerchantCta from '../MerchantCta';
import { formatMoney, priceAsOfLabel, stockLabel } from '../../lib/format';
import { CELEBRITY_WEB } from '../../lib/site-copy';
import type { PieceProduct } from '../../lib/spotted';
import { Tag } from '../ui/Tag';
import { cx } from '../ui/cx';
import { hasPrice, itemName, offerCopy, shownStock, stockIsOut, variantFacts } from './model';
import styles from './PieceProductTile.module.css';

/**
 * One product tagged into an outfit piece. EXACT: "Exact match" with the
 * API's evidence line; SIMILAR (under the piece's "Similar styles" heading,
 * no tag of its own): the API's line for this item ("Similar style. <name> did not wear or endorse this product.") right
 * under the name, the same size as the name's meta line. Then the price as
 * the shop shows it (Amazon.in: only a product-API price inside its hour,
 * "as of … IST" with Amazon's disclaimer; otherwise "See price on
 * Amazon.in"), the tracked call to action (/r/ only; "Buy on Amazon.in") and
 * the programme's statement right under the button (Amazon.in: the
 * Associate statement, OA §10, beside every button). No product image: the
 * shop never draws Amazon's images, and nothing sits on the still.
 */
export function PieceProductTile({ product, variant }: { product: PieceProduct; variant: 'exact' | 'similar' }) {
  const copy = offerCopy(product);
  const facts = variantFacts(product.variant);
  const stock = shownStock(product);
  const asOf = hasPrice(product) ? priceAsOfLabel(product.priceAsOf) : null;
  const name = itemName(product);
  return (
    <div className={cx(styles.tile, variant === 'exact' ? styles.exact : styles.similar)} data-match={product.match}>
      {/* EXACT carries its tag; a similar tile sits under the "Similar styles" heading and says it in its own line. */}
      {product.match === 'exact' ? <Tag variant="accent">{CELEBRITY_WEB.exactTag}</Tag> : null}
      <p className={styles.name}>{name}</p>
      <p className={styles.wording} data-item-wording="">
        {product.match === 'exact' ? `${product.wordingLabel}. ${product.wordingDetail}` : product.wordingDetail}
      </p>
      {facts.length > 0 ? <p className={styles.variant}>{facts.join(' · ')}</p> : null}
      {hasPrice(product) ? (
        <div className={styles.price}>
          <span className={styles.priceLabel}>{copy.priceLabel}</span>
          <span className={styles.amount}>{formatMoney(product.price_minor, product.currency)}</span>
          {product.merchant || stock ? (
            <span className={styles.merchant}>
              {product.merchant ? <>at {product.merchant}</> : null}
              {product.merchant && stock ? ' · ' : null}
              {stock ? <span className={cx(stockIsOut(stock) && styles.out)}>{stockLabel(stock)}</span> : null}
            </span>
          ) : null}
          {asOf ? (
            <span className={styles.fresh}>
              ({asOf}) {copy.priceDisclaimer}
            </span>
          ) : null}
        </div>
      ) : product.available ? (
        <p className={styles.noPrice}>{copy.noPriceLabel}</p>
      ) : null}
      <MerchantCta linkUrl={product.linkUrl} available={product.available} label={copy.ctaLabel} itemName={name} touch className={styles.cta} />
      {copy.disclosures.map((d) => (
        <p key={d} className={styles.disclosure}>
          {d}
        </p>
      ))}
    </div>
  );
}
