/**
 * Convert a price in paise (INR minor units) to a display string.
 * Example: 249900 -> "₹2,499"
 */
export function formatINR(minor: number): string {
  const rupees = Math.round(minor / 100);
  return '₹' + rupees.toLocaleString('en-IN');
}

/**
 * Human-friendly relative time for an ISO freshness timestamp.
 * Example: timeAgo('2026-09-22T10:00:00.000Z') -> "2h ago"
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}
