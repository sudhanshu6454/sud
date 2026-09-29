import styles from './Disclosure.module.css';

/**
 * Reusable affiliate disclosure box.
 */
export default function Disclosure() {
  return (
    <aside className={styles.box} aria-label="Affiliate disclosure">
      <strong>Affiliate disclosure:</strong> we may earn a commission when you
      shop via these links, at no extra cost to you.
    </aside>
  );
}
