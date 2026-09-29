import { ctaState } from './shop/model';
import { cx } from './ui/cx';
import styles from './MerchantCta.module.css';

interface Props {
  /** Tracked redirect URL from the API (`/r/{token}`), or null. Never a raw merchant URL. */
  linkUrl: string | null;
  /** false → the item has no live offer: no CTA at all, just the notice. */
  available: boolean;
  /** Label of the live link. Default "View at merchant" (a " →" is appended, hidden from assistive technology). */
  label?: string;
  /** Names the item for assistive technology, e.g. "Demo Kaya — Oversized Wool-Blend Blazer". */
  itemName?: string;
  /** Always at least 44px tall (it is on phones regardless). */
  touch?: boolean;
  className?: string;
}

/**
 * The only outbound element on the shop, drawn as the handover's primary
 * block button (accent fill, label flush left, " →"). Same-tab link (the
 * redirect service 302s to the merchant) with rel="sponsored nofollow
 * noopener". Without a minted link it is a visibly disabled control, never
 * '#' and never a merchant domain (the API does not return one); without a
 * live offer it is the "Not available right now" notice.
 */
export default function MerchantCta({ linkUrl, available, label = 'View at merchant', itemName, touch = false, className }: Props) {
  const state = ctaState({ available, linkUrl });

  if (state.kind === 'unavailable') {
    return <p className={cx(styles.box, styles.unavailable, touch && styles.touch, className)}>Not available right now</p>;
  }

  if (state.kind === 'link') {
    return (
      <a
        href={state.href}
        rel="sponsored nofollow noopener"
        className={cx(styles.box, styles.cta, touch && styles.touch, className)}
        aria-label={itemName ? `${label}: ${itemName}` : undefined}
      >
        <span>
          {label}
          <span aria-hidden="true"> →</span>
        </span>
      </a>
    );
  }

  return (
    <span
      className={cx(styles.box, styles.cta, styles.disabled, touch && styles.touch, className)}
      role="link"
      aria-disabled="true"
      title="No tracked link has been minted for this offer yet"
    >
      Link not available yet
    </span>
  );
}
