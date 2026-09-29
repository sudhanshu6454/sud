-- 0005_looks_web: web-facing look metadata for the consumer shop.
--
-- The consumer web app (packages/web) renders published looks from the API
-- instead of local mock data. It needs three things the core schema did not
-- carry: where the look was spotted (attribution line on the page), whether
-- the look is a paid placement (the "Sponsored" label the ASCI disclosure
-- rules require), and something to render as the cover.
--
-- Nothing here touches money, attribution, or tenant scoping: every column
-- is nullable metadata (or a boolean defaulting to false) read by the
-- catalogue endpoints only.

alter table looks
  add column source_page text;

alter table looks
  add column sponsored boolean not null default false;

alter table looks
  add column cover_asset_id uuid references assets(id);

-- storage_key stays the canonical object key; public_url is the resolvable
-- (CDN) URL the web app can put in an <img>. NULL means "no public copy",
-- and the page falls back to its placeholder artwork.
alter table assets
  add column public_url text;

-- The consumer list query: published looks for one tenant, newest first.
create index idx_looks_org_status_published on looks (org_id, status, published_at desc);
