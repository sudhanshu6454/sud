import Link from 'next/link';
import MatchBadge from '../MatchBadge';
import MerchantCta from '../MerchantCta';
import SaveButton from '../SaveButton';
import { formatMoney, freshnessLabel, priceAsOfLabel, stockLabel } from '../../lib/format';
import { itemHref } from '../../lib/saved';
import type { LookDetail, LookItem } from '../../lib/types';
import { cx } from '../ui/cx';
import { hasPrice, itemName, offerCopy, shownStock, stockIsOut, storablePrice, variantFacts } from './model';
import styles from './ItemRow.module.css';

/**
 * One product of a look, as a list row in the 1d cell order: match tag and
 * Save, the product name (links to its page), the matched variant, the price
 * (12px label over 24px / 800) with merchant and stock on the right, the
 * price freshness, then the merchant CTA (primary block button). An item
 * without a live offer shows no price and "Not available right now".
 *
 * A live offer whose price may not be shown (Amazon.in without a
 * product-API price younger than 1 hour: the API sends none) says "See
 * price on Amazon.in" instead; a time-stamped price carries "as of … IST"
 * and Amazon's disclaimer instead of the freshness line. Amazon offers get
 * the "Buy on Amazon.in" label and the Associate statement under the CTA
 * (offerCopy, lib/site-copy.ts AMAZON_IN). The CTA is still only the tracked
 * /r/{token} link.
 */
export function ItemRow({ look, item }: { look: Pick<LookDetail, 'id' | 'title'>; item: LookItem }) {
  const facts = variantFacts(item.variant);
  const name = itemName(item);
  const copy = offerCopy(item);
  const stock = shownStock(item);
  const asOf = hasPrice(item) ? priceAsOfLabel(item.priceAsOf) : null;
  const saved = storablePrice(item);
  return (
    <li className={styles.row}>
      <div className={styles.head}>
        <MatchBadge match={item.match} />
        <SaveButton
          lookId={look.id}
          itemId={item.id}
          lookTitle={look.title}
          brand={item.brand}
          model={item.model}
          merchant={item.merchant}
          price_minor={saved.price_minor}
          priceNotStored={saved.priceNotStored}
          currency={item.currency}
        />
      </div>
      <h3 className={styles.name}>
        <Link href={itemHref(look.id, item.id)} className={styles.nameLink}>
          {name}
        </Link>
      </h3>
      {facts.length > 0 ? <p className={styles.variant}>{facts.join(' · ')}</p> : null}
      {hasPrice(item) ? (
        <>
          <div className={styles.priceRow}>
            <div>
              <div className={styles.priceLabel}>{copy.priceLabel}</div>
              <div className={styles.price}>{formatMoney(item.price_minor, item.currency)}</div>
            </div>
            <div className={styles.merchant}>
              {item.merchant ? <>at {item.merchant}</> : null}
              {item.merchant && stock ? ' · ' : null}
              {stock ? <span className={cx(stockIsOut(stock) && styles.out)}>{stockLabel(stock)}</span> : null}
            </div>
          </div>
          {asOf ? (
            <p className={styles.fresh}>
              ({asOf}) {copy.priceDisclaimer}
            </p>
          ) : item.freshness ? (
            <p className={styles.fresh}>{freshnessLabel(item.freshness)}</p>
          ) : null}
        </>
      ) : item.available ? (
        <p className={styles.noPrice}>{copy.noPriceLabel}</p>
      ) : null}
      <MerchantCta linkUrl={item.linkUrl} available={item.available} label={copy.ctaLabel} itemName={name} />
      {copy.disclosures.map((d) => (
        <p key={d} className={styles.disclosure}>
          {d}
        </p>
      ))}
    </li>
  );
}
