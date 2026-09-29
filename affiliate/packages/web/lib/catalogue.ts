/**
 * SERVER-ONLY catalogue client for the consumer shop.
 *
 * The `server-only` package is not installed, so the guard is by convention:
 * import this module ONLY from server components / route handlers, never
 * from a 'use client' file (it reads WEB_API_TOKEN, which must never reach
 * the browser). The tests in test/catalogue.test.ts run it under node.
 *
 * Contract (packages/api/src/routes/looks.ts, docs/openapi.yaml):
 *   GET /v1/looks?page&page_size            → { items: LookRow[], page, page_size, total }
 *   GET /v1/looks/:id?placement_id=<uuid>   → LookDetailRow (items with live offer + tracked link)
 *
 * Fallback rule: no WEB_API_TOKEN, or any API failure other than a clean
 * 404 on the detail call, returns the TEST-labelled mock data with
 * `demo: true`; the page must then render <DemoBadge />. A 404 in live mode
 * is a real "not found" (the page calls notFound()).
 *
 * Data caching: every fetch carries `next: { revalidate: 60 }`, so the
 * rendered pages (which are dynamic) reuse the API response for 60 s.
 */
import { mockLook, mockLooks } from './mock-data';
import { apiBase, webApiToken, webPlacementId } from './server-env';
import { gradientSeedFor } from './types';
import type { CatalogueResult, LookDetail, LookItem, LookSummary, Match } from './types';

export const REVALIDATE_SECONDS = 60;
/** Page size for the shop grid; the API caps page_size at 100. */
const LIST_PAGE_SIZE = 100;

/* ---------- wire shapes (subset we read) ---------- */

export interface LookRow {
  id: string;
  title: string;
  locale: string;
  category: string | null;
  published_at: string | null;
  source_page: string | null;
  sponsored: boolean;
  cover_url: string | null;
  item_count: number;
}

export interface LookListData {
  items: LookRow[];
  page: number;
  page_size: number;
  total: number;
}

export interface LookItemRow {
  id: string;
  match_type: Match | null;
  evidence: string | null;
  product: { id: string; brand: string; model: string; category: string };
  variant: { id: string; size_text: string | null; colour: string | null; merchant_sku: string | null };
  offer: {
    id: string;
    programme_id: string;
    merchant: { id: string; name: string };
    price_minor: number;
    currency: string;
    stock_status: string;
    fresh_until: string;
  } | null;
  link: { token: string; url: string } | null;
}

export interface LookDetailRow extends Omit<LookRow, 'item_count'> {
  status: string;
  items: LookItemRow[];
  placement: { id: string; property_id: string; campaign_id: string } | null;
}

/* ---------- mapping (pure, unit-tested) ---------- */

export function mapLookSummary(row: LookRow): LookSummary {
  return {
    id: row.id,
    title: row.title,
    category: row.category ?? null,
    locale: row.locale,
    sourcePage: row.source_page ?? null,
    sponsored: row.sponsored === true,
    coverUrl: row.cover_url ?? null,
    gradientSeed: gradientSeedFor(row.id),
    publishedAt: row.published_at ?? null,
    itemCount: Number(row.item_count ?? 0),
  };
}

export function mapLookItem(row: LookItemRow): LookItem {
  const offer = row.offer;
  return {
    id: row.id,
    brand: row.product.brand,
    model: row.product.model,
    category: row.product.category,
    variant: {
      size: row.variant.size_text ?? null,
      colour: row.variant.colour ?? null,
      sku: row.variant.merchant_sku ?? null,
    },
    match: row.match_type === 'exact' || row.match_type === 'similar' ? row.match_type : null,
    evidence: row.evidence ?? null,
    available: offer !== null,
    merchant: offer ? offer.merchant.name : null,
    price_minor: offer ? offer.price_minor : null,
    currency: offer ? offer.currency : null,
    freshness: offer ? offer.fresh_until : null,
    stock: offer ? offer.stock_status : null,
    // Only ever the tracked redirect URL; the API never returns offer_url.
    linkUrl: offer && row.link ? row.link.url : null,
  };
}

export function mapLookDetail(row: LookDetailRow): LookDetail {
  return {
    ...mapLookSummary({ ...row, item_count: row.items.length }),
    items: row.items.map(mapLookItem),
  };
}

/* ---------- transport ---------- */

export class CatalogueApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CatalogueApiError';
    this.status = status;
    this.code = code;
  }
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
    throw new CatalogueApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `HTTP ${res.status}`);
  }
  const data = (parsed as { data?: T } | null)?.data;
  if (data === undefined) throw new CatalogueApiError(res.status, 'INTERNAL', 'Malformed API envelope');
  return data;
}

/** Published looks for the shop grid (all pages, newest first as the API orders them). */
export async function listLooks(): Promise<CatalogueResult<LookSummary[]>> {
  const token = webApiToken();
  if (!token) return { value: mockLooks(), demo: true };
  try {
    const rows: LookRow[] = [];
    let page = 1;
    for (;;) {
      const data = await apiGet<LookListData>(`/v1/looks?page=${page}&page_size=${LIST_PAGE_SIZE}`, token);
      rows.push(...data.items);
      if (data.items.length === 0 || rows.length >= data.total || page >= 50) break;
      page += 1;
    }
    return { value: rows.map(mapLookSummary), demo: false };
  } catch {
    return { value: mockLooks(), demo: true };
  }
}

/**
 * One look with items, live offers and (with WEB_PLACEMENT_ID) tracked links.
 * Live 404 → `{ value: null, demo: false }` so the page can notFound().
 */
export async function getLook(id: string): Promise<CatalogueResult<LookDetail | null>> {
  const token = webApiToken();
  if (!token) return { value: mockLook(id), demo: true };
  const placement = webPlacementId();
  const qs = placement ? `?placement_id=${encodeURIComponent(placement)}` : '';
  try {
    const row = await apiGet<LookDetailRow>(`/v1/looks/${encodeURIComponent(id)}${qs}`, token);
    return { value: mapLookDetail(row), demo: false };
  } catch (err) {
    // 404 (unknown / unpublished look, or a non-uuid id → 400) is a real miss, not an outage.
    if (err instanceof CatalogueApiError && (err.status === 404 || err.status === 400)) {
      return { value: null, demo: false };
    }
    return { value: mockLook(id), demo: true };
  }
}
