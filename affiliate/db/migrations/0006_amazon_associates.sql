-- 0006_amazon_associates: Amazon.in Associates as a programme of the operator's
-- own network (packages/api/ASSUMPTIONS.md "Amazon.in Associates").
--
-- Additive only: new tables, nullable columns and checks that every row
-- already in the database satisfies (the live database holds the seeded
-- network and no programme, offer or conversion). No triggers (pg-mem runs
-- these files in the test suite).
--
-- Money stays bigint minor units (paise). Every new tenant table carries
-- org_id references organisations(id).

-- ---------------------------------------------------------------------------
-- 1. The Associates account behind an Amazon programme: one per organisation
--    and marketplace, one per programme.
--    store_id        the account's own Associates ID (the default tracking ID,
--                    "<store>-21"): the tag of every placement that has no
--                    tracking ID of its own. Never an attribution basis.
--    account_ref     written to conversions.provider_account_id for this
--                    account's report rows ('amazon-associates:<store_id>');
--                    the idempotency key's first part.
--    api_paused_until the workers' product-API refresh skips the account
--                    until then (set on a 429 ThrottleException from
--                    retryAfterSeconds, else the next UTC day; and on a 403
--                    such as AssociateNotEligible), so an exhausted
--                    allowance is not hit again every hour.
-- There is deliberately NO sub-tag setting and NO third-party setting:
--    - no click id ever goes on an Amazon URL (LR: "Under no circumstances
--      may you associate any sub-tag with a specific end user of your
--      site"; no approval makes a per-click id allowed);
--    - links carrying the tag go on properties with an owner_operated
--      verification only (PR 9: only on "your site"; OA §11: no tag
--      "assigned to anyone other than you"); nothing turns that off.
create table amazon_associates_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  programme_id uuid not null unique references programmes(id),
  marketplace_host text not null,
  store_id text not null,
  account_ref text not null unique,
  currency text not null default 'INR',
  disclosure_text text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  api_paused_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, marketplace_host)
);
create index idx_amazon_associates_accounts_org on amazon_associates_accounts(org_id);

-- ---------------------------------------------------------------------------
-- 2. Tracking IDs created in Associates Central, each mapped to exactly one
--    placement (the placement of one declared property in the Amazon
--    campaign). Append-only by convention: the setup CLI never remaps a
--    tracking ID or gives a placement a second one. effective_from is when
--    the mapping began; a report row dated before it is not attributed by
--    it (suspense).
create table amazon_tracking_ids (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  account_id uuid not null references amazon_associates_accounts(id),
  tracking_id text not null,
  placement_id uuid not null references placements(id),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (account_id, tracking_id),
  unique (account_id, placement_id)
);
create index idx_amazon_tracking_ids_org on amazon_tracking_ids(org_id);
create index idx_amazon_tracking_ids_placement on amazon_tracking_ids(placement_id);

-- ---------------------------------------------------------------------------
-- 3. Offers whose price may not be shown. An Amazon offer is created without
--    a price (price_minor NULL): a price may only be displayed when it came
--    from Amazon's product API, with its time (price_as_of), and for at most
--    programme_capabilities.price_max_age_hours (Amazon: 1 — the Creators
--    API's "Offers | 1 hour", stricter than OA §11's 24 hours). NULL price =
--    "see the current price on the merchant's site". Existing offers keep
--    their price and a NULL price_as_of (the rule before this migration:
--    valid until fresh_until).
--    merchant_item_ref = the merchant's own item id (Amazon: the ASIN).
--    stale_reason = why a 'stale' offer is stale when the merchant said so
--    ('merchant_not_accessible': Amazon's product API reported the item no
--    longer accessible). The offers CLI never reactivates such an offer
--    unless told to (--reactivate); the refresh does when Amazon lists the
--    item again.
alter table offers alter column price_minor drop not null;
alter table offers add column price_as_of timestamptz;
alter table offers add column merchant_item_ref text;
alter table offers add column stale_reason text;
alter table offers
  add constraint offers_price_as_of_check
  check (price_as_of is null or price_minor is not null);
alter table offers
  add constraint offers_stale_reason_check
  check (stale_reason is null or stale_reason in ('merchant_not_accessible'));
create index idx_offers_org_programme_item on offers(org_id, programme_id, merchant_item_ref);

alter table programme_capabilities add column price_max_age_hours int;
alter table programme_capabilities
  add constraint programme_capabilities_price_max_age_check
  check (price_max_age_hours is null or price_max_age_hours > 0);

-- ---------------------------------------------------------------------------
-- 4. Conversions attributed without a click. An Amazon earnings-report row
--    carries the tracking ID it was earned under, not a click id. When that
--    tracking ID maps to exactly one placement (section 2) the conversion is
--    attributed to that placement: placement_id is set and click_id stays
--    NULL. The ledger then walks placement → campaign → publisher exactly as
--    the click chain does after its first hop (src/finance.ts). Never both.
--    Suspense becomes click_id IS NULL AND placement_id IS NULL.
--    returned_tracking_ref  the tracking ID the provider reported (evidence).
--    item_ref               the provider's item id (Amazon: the ASIN), for
--                           matching a later return to its sale.
--    suspense_reason        why an unattributed row stayed unattributed, set
--                           at ingest from data only (NULL = derived as
--                           before: NO_CLICK_REF / CLICK_REF_UNMATCHED).
alter table conversions add column placement_id uuid references placements(id);
alter table conversions add column returned_tracking_ref text;
alter table conversions add column item_ref text;
alter table conversions add column suspense_reason text;
alter table conversions
  add constraint conversions_single_attribution_check
  check (click_id is null or placement_id is null);
alter table conversions
  add constraint conversions_suspense_reason_check
  check (suspense_reason is null or suspense_reason in (
    'TRACKING_ID_UNMAPPED', 'TRACKING_ID_IS_STORE_DEFAULT',
    'TRACKING_ID_MAPPED_AFTER_SALE', 'ATTRIBUTION_CONFLICT'
  ));
create index idx_conversions_placement on conversions(placement_id);
create index idx_conversions_tracking
  on conversions(org_id, provider_account_id, returned_tracking_ref, item_ref);
