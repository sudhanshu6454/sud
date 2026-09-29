import { SHOP_DISCLOSURE } from '../Disclosure';
import styles from './DisclosureLine.module.css';

/** The standing one-line affiliate disclosure (13px, the footer's type) at the end of the grid and the wishlist. */
export function DisclosureLine() {
  return (
    <p className={styles.line}>
      <span className={styles.label}>Affiliate disclosure:</span> {SHOP_DISCLOSURE}
    </p>
  );
}
