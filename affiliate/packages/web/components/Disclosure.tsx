import { cx } from './ui/cx';
import styles from './Disclosure.module.css';

/**
 * The consumer-facing affiliate disclosure (shop pages). Existing wording,
 * kept verbatim; it is not the creator "#ad" line in lib/site-copy.ts, and
 * neither is a counsel-approved disclosure yet.
 */
export const SHOP_DISCLOSURE = 'We may earn a commission when you shop via these links, at no extra cost to you.';

/**
 * The disclosure as a surface panel: eyebrow label over 14px copy. `lines`
 * adds the programmes' own statements after the shop's line (Amazon.in: "As
 * an Amazon Associate I earn from qualifying purchases.", OA §10), each once.
 */
export default function Disclosure({ className, lines = [] }: { className?: string; lines?: ReadonlyArray<string> }) {
  const extra = lines.filter((l, i) => l.trim() !== '' && l !== SHOP_DISCLOSURE && lines.indexOf(l) === i);
  return (
    <aside className={cx(styles.panel, className)} aria-label="Affiliate disclosure">
      <p className={styles.label}>Affiliate disclosure</p>
      <p className={styles.copy}>{SHOP_DISCLOSURE}</p>
      {extra.map((l) => (
        <p key={l} className={cx(styles.copy, styles.more)}>
          {l}
        </p>
      ))}
    </aside>
  );
}
