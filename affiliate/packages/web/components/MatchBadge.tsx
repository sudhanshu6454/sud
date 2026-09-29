import type { Match } from '../lib/types';
import { matchTag } from './shop/model';
import { Tag } from './ui/Tag';

/**
 * The editors' match verdict as a tag: "Exact item" (accent), "Similar
 * style" (neutral); a look item without a verdict shows "Unverified match"
 * (outline, the system's review state).
 */
export default function MatchBadge({ match, className }: { match: Match | null; className?: string }) {
  const { label, tone } = matchTag(match);
  return (
    <Tag variant={tone} className={className}>
      {label}
    </Tag>
  );
}
