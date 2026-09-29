/**
 * Whether an offer's price may be shown, and which (GET /v1/looks/:id,
 * GET /v1/offers). Two regimes:
 *
 * - programmes without a price age limit (programme_capabilities
 *   .price_max_age_hours NULL — every programme before 0006): the stored
 *   price, valid while the offer is live (fresh_until), as before;
 * - programmes with a limit (Amazon.in Associates: 1 hour — the Creators
 *   API's "Offers | 1 hour", stricter than Operating Agreement §11's 24
 *   hours; AMAZON_PRICE_MAX_AGE_HOURS): only a price that came with its time (offers.price_as_of)
 *   and is younger than the limit. Anything else is NULL — "see the current
 *   price at the merchant" — never an old price, never a zero.
 *
 * A price time more than CLOCK_SKEW_MS in the future is treated as invalid.
 */
const CLOCK_SKEW_MS = 5 * 60_000;

export interface PricedOfferRow {
  price_minor: string | number | null;
  /** timestamptz: pg returns string, pg-mem returns Date. */
  price_as_of?: string | Date | null;
  price_max_age_hours?: number | string | null;
}

export function displayablePrice(
  row: PricedOfferRow,
  now: number = Date.now(),
): { price_minor: number | null; price_as_of: string | null } {
  if (row.price_minor === null || row.price_minor === undefined) return { price_minor: null, price_as_of: null };
  const maxAge = row.price_max_age_hours === null || row.price_max_age_hours === undefined ? null : Number(row.price_max_age_hours);
  const asOf = row.price_as_of ? new Date(row.price_as_of) : null;
  if (maxAge === null) {
    return { price_minor: Number(row.price_minor), price_as_of: asOf ? asOf.toISOString() : null };
  }
  if (!asOf || Number.isNaN(asOf.getTime())) return { price_minor: null, price_as_of: null };
  const age = now - asOf.getTime();
  if (age < -CLOCK_SKEW_MS || age > maxAge * 3_600_000) return { price_minor: null, price_as_of: null };
  return { price_minor: Number(row.price_minor), price_as_of: asOf.toISOString() };
}

/**
 * The stock status to show with that price. Availability is Product
 * Advertising Content under the same rule as the price (the Linking
 * Requirements: "your site may only show prices and availability if …"),
 * so for a programme with a price age limit the stored status is shown only
 * together with a displayable price; otherwise 'unknown'. Programmes without
 * a limit keep their stored status.
 */
export function displayableStock(
  row: { stock_status: string; price_max_age_hours?: number | string | null },
  price: { price_as_of: string | null },
): string {
  const limited = row.price_max_age_hours !== null && row.price_max_age_hours !== undefined;
  if (!limited) return row.stock_status;
  return price.price_as_of ? row.stock_status : 'unknown';
}
