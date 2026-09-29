import type { Stock } from './types';

/**
 * Convert a price in paise (INR minor units) to a display string.
 * Example: 249900 -> "₹2,499"
 */
export function formatINR(minor: number): string {
  const rupees = Math.round(minor / 100);
  return '₹' + rupees.toLocaleString('en-IN');
}

/**
 * Display a price given in minor units with its explicit currency.
 * INR keeps the platform's rupee style; anything else goes through Intl.
 */
export function formatMoney(minor: number, currency: string): string {
  if (currency === 'INR') return formatINR(minor);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
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

/**
 * Freshness sentence for an offer's `fresh_until`. The API only returns
 * offers whose fresh_until is still in the future, so "valid until" is the
 * honest phrasing; a past value (demo data or clock skew) reads as expired.
 */
export function freshnessLabel(freshUntilIso: string, now: Date = new Date()): string {
  const until = new Date(freshUntilIso);
  if (Number.isNaN(until.getTime())) return 'Price freshness unknown — check current price at merchant';
  if (until.getTime() <= now.getTime()) {
    return `Price check expired ${timeAgo(freshUntilIso, now)} — check current price at merchant`;
  }
  const diffMin = Math.round((until.getTime() - now.getTime()) / 60000);
  const window =
    diffMin < 60 ? `${Math.max(1, diffMin)}m` : diffMin < 24 * 60 ? `${Math.round(diffMin / 60)}h` : `${Math.round(diffMin / (24 * 60))}d`;
  return `Price valid for ${window} — check current price at merchant`;
}

export function stockLabel(stock: Stock): string {
  switch (stock) {
    case 'in_stock':
      return 'In stock';
    case 'low_stock':
      return 'Low stock';
    case 'out_of_stock':
      return 'Out of stock';
    default:
      return stock.replace(/_/g, ' ');
  }
}
