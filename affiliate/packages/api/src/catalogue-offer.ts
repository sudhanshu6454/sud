/**
 * The live offer of a variant, shared by the catalogue endpoints
 * (routes/looks.ts) and the celebrity looks (src/looks/bundle.ts).
 */

export interface LiveOfferRow {
  id: string;
  programme_id: string;
  merchant_id: string;
  merchant_name: string;
  price_minor: string | number | null;
  price_as_of: string | Date | null;
  price_max_age_hours: number | null;
  disclosure_text: string | null;
  connector: string;
  currency: string;
  stock_status: string;
  fresh_until: string | Date;
}

/**
 * The live offer for a variant: offer active + fresh AND its programme
 * active (a paused programme's offers are not shoppable). Several live
 * offers → the cheapest, ties broken by id; an offer without a price (an
 * Amazon offer before or after its price's hour) sorts last. `offer_url`
 * is deliberately NOT in the select list. The price shown is
 * displayablePrice (src/offer-price.ts), and so is the stock status
 * (displayableStock: availability is under the same age limit);
 * `disclosure_text` is the programme's own disclosure (Amazon: the Operating
 * Agreement's statement) and `connector` tells the shop which merchant copy
 * to show (Amazon: "Buy on Amazon.in", the price disclaimer).
 */
export const LIVE_OFFER_SQL = `
  select o.id, o.programme_id, o.merchant_id, m.name as merchant_name, pr.connector as connector,
         o.price_minor::text as price_minor, o.price_as_of, o.currency, o.stock_status, o.fresh_until,
         pc.price_max_age_hours as price_max_age_hours, aa.disclosure_text as disclosure_text
    from offers o
    join programmes pr on pr.id = o.programme_id and pr.org_id = $1
    join merchants m on m.id = o.merchant_id and m.org_id = $1
    left join programme_capabilities pc on pc.programme_id = o.programme_id
    left join amazon_associates_accounts aa on aa.programme_id = o.programme_id and aa.org_id = $1
   where o.org_id = $1 and o.variant_id = $2
     and o.status = 'active' and o.fresh_until > now()
     and pr.status = 'active'
   order by o.price_minor asc nulls last, o.id asc
   limit 1`;

