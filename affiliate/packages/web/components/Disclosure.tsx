import { cx } from './ui/cx';
import styles from './Disclosure.module.css';

/**
 * The consumer-facing affiliate disclosure (shop pages). Existing wording,
 * kept verbatim; it is not the creator "#ad" line in lib/site-copy.ts, and
 * neither is a counsel-approved disclosure yet.
 */
export const SHOP_DISCLOSURE = 'We may earn a commission when you shop via these links, at no extra cost to you.';

/** The disclosure as a surface panel: eyebrow label over 14px copy. */
export default function Disclosure({ className }: { className?: string }) {
  return (
    <aside className={cx(styles.panel, className)} aria-label="Affiliate disclosure">
      <p className={styles.label}>Affiliate disclosure</p>
      <p className={styles.copy}>{SHOP_DISCLOSURE}</p>
    </aside>
  );
}
