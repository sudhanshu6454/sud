-- Paparazzi Affiliate Commerce Platform — core schema (v1)
-- Postgres 16. Money is bigint minor units everywhere, check >= 0.
-- Every tenant table carries org_id references organisations(id).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- organisations
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------ users
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table memberships (
  user_id uuid not null references users(id),
  org_id uuid not null references organisations(id),
  role text not null check (role in ('network_admin','editor','publisher_owner','publisher_analyst','merchant_manager','finance_operator','finance_approver')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- ------------------------------------------------------------------- publishers
create table publishers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  legal_name text not null,
  country text not null,
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  created_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  publisher_id uuid not null references publishers(id),
  platform text not null,
  external_account_id text not null,
  canonical_url text,
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  created_at timestamptz not null default now(),
  unique (platform, external_account_id)
);

create table verifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  property_id uuid not null references properties(id),
  method text not null,
  verified_by uuid references users(id),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------- merchants
create table merchants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  name text not null,
  created_at timestamptz not null default now()
);

create table programmes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  merchant_id uuid not null references merchants(id),
  connector text not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','blocked')),
  attribution_window_days int not null default 30,
  validation_delay_days int not null default 30,
  returns_window_days int not null default 30,
  commission_basis text not null,
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now()
);

create table programme_capabilities (
  programme_id uuid primary key references programmes(id),
  countries text[] not null default '{}',
  currency text not null default 'INR',
  allowed_domains text[] not null default '{}',
  subpublisher_allowed boolean not null default false,
  policy_url text,
  next_review_date date
);

-- --------------------------------------------------------------------- catalogue
create table products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  gtin text,
  brand text not null,
  model text not null,
  category text not null,
  created_at timestamptz not null default now()
);

create table variants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  product_id uuid not null references products(id),
  size_text text,
  colour text,
  merchant_sku text,
  created_at timestamptz not null default now()
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  variant_id uuid not null references variants(id),
  programme_id uuid not null references programmes(id),
  merchant_id uuid not null references merchants(id),
  price_minor bigint not null check (price_minor >= 0),
  currency text not null default 'INR',
  stock_status text not null default 'in_stock',
  offer_url text not null,
  fresh_until timestamptz not null,
  status text not null default 'active' check (status in ('active','stale','revoked')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------ looks
create table assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  storage_key text not null,
  license text not null,
  territory text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table looks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  title text not null,
  locale text not null default 'en',
  category text,
  status text not null default 'draft' check (status in ('draft','in_review','ready','published','paused','withdrawn')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table look_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  look_id uuid not null references looks(id),
  asset_id uuid not null references assets(id),
  variant_id uuid not null references variants(id),
  match_type text check (match_type in ('exact','similar')),
  evidence text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------- tracking
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  publisher_id uuid not null references publishers(id),
  programme_id uuid not null references programmes(id),
  name text not null,
  created_at timestamptz not null default now()
);

create table placements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  campaign_id uuid not null references campaigns(id),
  property_id uuid not null references properties(id),
  channel text not null,
  placement_key text not null unique,
  created_at timestamptz not null default now()
);

create table links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  token text not null unique,
  placement_id uuid not null references placements(id),
  offer_id uuid not null references offers(id),
  contract_version_id uuid,
  route_signature text not null,
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now()
);

create table clicks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  link_id uuid not null references links(id),
  click_id text not null unique,
  occurred_at timestamptz not null default now(),
  context jsonb,
  created_at timestamptz not null default now()
);

create table conversions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  programme_id uuid not null references programmes(id),
  provider_account_id text not null,
  source_transaction_id text not null,
  line_id text,
  returned_click_ref text,
  -- Nullable on purpose: NULL means suspense / unattributed. Never guessed.
  click_id uuid references clicks(id),
  currency text not null,
  eligible_value_minor bigint not null check (eligible_value_minor >= 0),
  commission_minor bigint not null check (commission_minor >= 0),
  provider_status text not null,
  provider_revision int not null default 0,
  status text not null default 'received' check (status in ('received','pending','approved','declined')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw jsonb,
  created_at timestamptz not null default now(),
  -- NULL line_id must not collapse into one dedupe bucket:
  -- nulls not distinct keeps each NULL line_id a distinct row.
  unique nulls not distinct (provider_account_id, source_transaction_id, line_id)
);

create table adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  conversion_id uuid not null references conversions(id),
  kind text not null check (kind in ('reversal','correction')),
  commission_delta_minor bigint not null check (commission_delta_minor >= 0),
  reason text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------- contracts
create table contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  publisher_id uuid not null references publishers(id),
  programme_id uuid not null references programmes(id),
  version int not null,
  publisher_share_bps int not null check (publisher_share_bps >= 0 and publisher_share_bps <= 10000),
  payout_threshold_minor bigint not null default 0 check (payout_threshold_minor >= 0),
  status text not null default 'draft',
  effective_from timestamptz,
  created_at timestamptz not null default now(),
  unique (publisher_id, programme_id, version)
);

-- ----------------------------------------------------------------------- ledger
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  currency text not null,
  account text not null check (account in ('merchant_receivable','publisher_liability','platform_commission')),
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  conversion_id uuid references conversions(id),
  adjustment_id uuid references adjustments(id),
  contract_version_id uuid,
  publisher_id uuid references publishers(id),
  idempotency_key text not null unique,
  memo text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------- finance
create table settlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  programme_id uuid not null references programmes(id),
  statement_ref text,
  period_start date,
  period_end date,
  status text not null default 'open' check (status in ('open','reconciled','disputed')),
  created_at timestamptz not null default now()
);

create table payout_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  currency text not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','processing','paid','failed')),
  prepared_by uuid references users(id),
  approved_by uuid references users(id),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_batch_id uuid not null references payout_batches(id),
  publisher_id uuid not null references publishers(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ governance
create table consent_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  subject_ref text not null,
  purpose text not null,
  version text not null,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  entity_id text not null,
  created_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  conversion_id uuid not null references conversions(id),
  status text not null default 'open' check (status in ('open','under_review','resolved','rejected')),
  evidence jsonb,
  created_at timestamptz not null default now()
);

create table outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  event_type text not null,
  payload jsonb not null,
  payload_hash text not null,
  occurred_at timestamptz not null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table idempotency_keys (
  key text primary key,
  org_id uuid references organisations(id),
  response jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------- indexes
-- org_id on the main tenant tables (multi-tenant query pattern).
create index idx_publishers_org on publishers(org_id);
create index idx_properties_org on properties(org_id);
create index idx_verifications_org on verifications(org_id);
create index idx_merchants_org on merchants(org_id);
create index idx_programmes_org on programmes(org_id);
create index idx_products_org on products(org_id);
create index idx_variants_org on variants(org_id);
create index idx_offers_org on offers(org_id);
create index idx_assets_org on assets(org_id);
create index idx_looks_org on looks(org_id);
create index idx_look_items_org on look_items(org_id);
create index idx_campaigns_org on campaigns(org_id);
create index idx_placements_org on placements(org_id);
create index idx_links_org on links(org_id);
create index idx_clicks_org on clicks(org_id);
create index idx_conversions_org on conversions(org_id);
create index idx_adjustments_org on adjustments(org_id);
create index idx_contracts_org on contracts(org_id);
create index idx_ledger_entries_org on ledger_entries(org_id);
create index idx_settlements_org on settlements(org_id);
create index idx_payout_batches_org on payout_batches(org_id);
create index idx_consent_records_org on consent_records(org_id);
create index idx_audit_log_org on audit_log(org_id);
create index idx_disputes_org on disputes(org_id);
create index idx_outbox_org on outbox(org_id);

-- Hot lookup paths. Note: links(token) and clicks(click_id) already carry
-- UNIQUE constraints (which create their own btree indexes); these explicit
-- indexes are belt-and-braces per the build contract and are redundant —
-- drop them if index bloat ever matters.
create index idx_links_token on links(token);
create index idx_clicks_click_id on clicks(click_id);

-- Attribution + dedupe lookups.
create index idx_conversions_click on conversions(click_id);
create index idx_conversions_provider on conversions(provider_account_id, source_transaction_id);
create index idx_ledger_entries_conversion on ledger_entries(conversion_id);
create index idx_ledger_entries_idempotency on ledger_entries(idempotency_key);
create index idx_outbox_unpublished on outbox(published_at) where published_at is null;
