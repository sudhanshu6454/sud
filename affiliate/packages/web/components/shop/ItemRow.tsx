import Link from 'next/link';
import MatchBadge from '../MatchBadge';
import MerchantCta from '../MerchantCta';
import SaveButton from '../SaveButton';
import { formatMoney, freshnessLabel, stockLabel } from '../../lib/format';
import { itemHref } from '../../lib/saved';
import type { LookDetail, LookItem } from '../../lib/types';
import { cx } from '../ui/cx';
import { hasPrice, itemName, stockIsOut, variantFacts } from './model';
import styles from './ItemRow.module.css';

/**
 * One product of a look, as a list row in the 1d cell order: match tag and
 * Save, the product name (links to its page), the matched variant, the price
 * (12px label over 24px / 800) with merchant and stock on the right, the
 * price freshness, then the merchant CTA (primary block button). An item
 * without a live offer shows no price and "Not available right now".
 */
export function ItemRow({ look, item }: { look: Pick<LookDetail, 'id' | 'title'>; item: LookItem }) {
  const facts = variantFacts(item.variant);
  const name = itemName(item);
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
          price_minor={item.price_minor}
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
              <div className={styles.priceLabel}>Price</div>
              <div className={styles.price}>{formatMoney(item.price_minor, item.currency)}</div>
            </div>
            <div className={styles.merchant}>
              {item.merchant ? <>at {item.merchant}</> : null}
              {item.merchant && item.stock ? ' · ' : null}
              {item.stock ? <span className={cx(stockIsOut(item.stock) && styles.out)}>{stockLabel(item.stock)}</span> : null}
            </div>
          </div>
          {item.freshness ? <p className={styles.fresh}>{freshnessLabel(item.freshness)}</p> : null}
        </>
      ) : null}
      <MerchantCta linkUrl={item.linkUrl} available={item.available} itemName={name} />
    </li>
  );
}
