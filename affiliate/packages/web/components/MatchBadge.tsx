import type { Match } from '../lib/types';
import styles from './MatchBadge.module.css';

/** "Exact item" / "Similar style"; a look item without a verdict shows "Unverified". */
export default function MatchBadge({ match }: { match: Match | null }) {
  if (match === 'exact') return <span className={styles.exact}>Exact item</span>;
  if (match === 'similar') return <span className={styles.similar}>Similar style</span>;
  return <span className={styles.unknown}>Unverified match</span>;
}
