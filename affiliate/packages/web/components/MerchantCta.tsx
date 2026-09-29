import styles from './MerchantCta.module.css';

interface Props {
  /** Tracked redirect URL from the API (`/r/{token}`), or null. Never a raw merchant URL. */
  linkUrl: string | null;
  /** false → the item has no live offer: no CTA at all, just the notice. */
  available: boolean;
  label?: string;
  size?: 'regular' | 'large';
}

/**
 * The only outbound element on the shop. Same-tab link (the redirect
 * service 302s to the merchant) with rel="sponsored nofollow noopener".
 * Without a minted link the CTA is a visibly disabled control, never '#'
 * and never a merchant domain (the API does not return one).
 */
export default function MerchantCta({ linkUrl, available, label = 'View at merchant', size = 'regular' }: Props) {
  const cls = size === 'large' ? `${styles.cta} ${styles.large}` : styles.cta;
  if (!available) {
    return (
      <p className={styles.unavailable} role="status">
        Not available right now
      </p>
    );
  }
  if (linkUrl) {
    return (
      <a href={linkUrl} rel="sponsored nofollow noopener" className={cls}>
        {label}
      </a>
    );
  }
  return (
    <span className={`${cls} ${styles.disabled}`} aria-disabled="true" role="link" title="No tracked link has been minted for this offer yet">
      Link not available yet
    </span>
  );
}
