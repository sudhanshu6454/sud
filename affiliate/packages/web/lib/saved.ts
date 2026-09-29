/**
 * Wishlist storage (browser only, localStorage key `saved-items`).
 *
 * Entries carry the look id + item id (the product route is
 * /looks/[id]/items/[itemId]) and enough display data to render /saved
 * without calling the API from the browser (the catalogue client is
 * server-only). No account sync.
 *
 * The pre-route-change key `saved-products` held bare mock ids that cannot
 * resolve any more; it is ignored.
 */

export const SAVED_KEY = 'saved-items';

export interface SavedItem {
  lookId: string;
  itemId: string;
  lookTitle: string;
  brand: string;
  model: string;
  merchant: string | null;
  /** The price when saved; always null for a time-limited price (see priceNotStored). */
  price_minor: number | null;
  currency: string | null;
  /**
   * true when the offer's price may not be kept (an Amazon.in offer: a
   * product-API price may be shown for 1 hour, stored for 24 hours at most,
   * OA §11), so none
   * was stored and /saved sends the shopper to the product page for it.
   */
  priceNotStored?: boolean;
  savedAt: string;
}

function isSavedItem(x: unknown): x is SavedItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.lookId === 'string' &&
    typeof o.itemId === 'string' &&
    typeof o.brand === 'string' &&
    typeof o.model === 'string'
  );
}

export function readSaved(): SavedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isSavedItem) : [];
  } catch {
    return [];
  }
}

function writeSaved(items: SavedItem[]): void {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable (private mode / quota) — wishlist is best-effort */
  }
}

export function isSaved(lookId: string, itemId: string): boolean {
  return readSaved().some((s) => s.lookId === lookId && s.itemId === itemId);
}

/** Add or remove; returns the new saved state for this item. */
export function toggleSaved(entry: Omit<SavedItem, 'savedAt'>): boolean {
  const list = readSaved();
  const idx = list.findIndex((s) => s.lookId === entry.lookId && s.itemId === entry.itemId);
  if (idx >= 0) {
    list.splice(idx, 1);
    writeSaved(list);
    return false;
  }
  // A time-limited price is never written, whatever the caller passed.
  const stored = entry.priceNotStored ? { ...entry, price_minor: null } : entry;
  list.push({ ...stored, savedAt: new Date().toISOString() });
  writeSaved(list);
  return true;
}

export function removeSaved(lookId: string, itemId: string): SavedItem[] {
  const next = readSaved().filter((s) => !(s.lookId === lookId && s.itemId === itemId));
  writeSaved(next);
  return next;
}

export function itemHref(lookId: string, itemId: string): string {
  return `/looks/${encodeURIComponent(lookId)}/items/${encodeURIComponent(itemId)}`;
}
