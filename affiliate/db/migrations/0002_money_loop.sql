-- Paparazzi Affiliate Commerce Platform — money-loop schema (v2)
-- Applies on top of 0001_core.sql. Money is bigint minor units everywhere.

-- ---------------------------------------------------------------------------
-- 1. Snapshot the contract version used for a conversion's ledger posting.
--    Set by postLedgerForConversion / the provider-events worker when an
--    approved conversion is posted; reversals read it back so the mirror
--    entries use the ORIGINAL split (never the current contract).
alter table conversions
  add column contract_version_id uuid references contracts(id);

-- ---------------------------------------------------------------------------
-- 2. Merchant cash actually collected (settlement/collection matching).
--    Payout prepare caps payable amounts by these pools, allocated pro-rata
--    across publishers by eligible-earnings share (see API ASSUMPTIONS.md).
create table merchant_settlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  programme_id uuid not null references programmes(id),
  currency text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  statement_ref text,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_merchant_settlements_org_prog_cur
  on merchant_settlements(org_id, programme_id, currency);

-- ---------------------------------------------------------------------------
-- 3. Payout rail transfers (one row per publisher item in a disbursed batch).
create table payout_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  payout_batch_id uuid not null references payout_batches(id),
  provider_ref text not null unique,
  status text not null
    check (status in ('initiated','processing','paid','failed','unknown')),
  idempotency_key text not null unique,
  last_status_query_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_payout_transfers_org_batch
  on payout_transfers(org_id, payout_batch_id);

-- ---------------------------------------------------------------------------
-- 4. Ledger: recognise the payout clearing account.
--    payout_clearing is relieved by bank reconciliation (out of scope);
--    the platform never pays out of thin air — see API ASSUMPTIONS.md.
alter table ledger_entries drop constraint ledger_entries_account_check;
alter table ledger_entries add constraint ledger_entries_account_check
  check (account in ('merchant_receivable','publisher_liability','platform_commission','payout_clearing'));

-- ---------------------------------------------------------------------------
-- 5. Ledger idempotency is per (posting key, account).
--    Every posting writes several balanced rows that SHARE one idempotency
--    key (e.g. 'conv:<id>', 'adj:<id>', 'payout:<batch>:<publisher>'), so the
--    key alone cannot stay unique per row — otherwise ON CONFLICT DO NOTHING
--    would persist only the first row of each posting and silently break
--    double-entry. The (key, account) pair is the dedupe unit.
alter table ledger_entries drop constraint ledger_entries_idempotency_key_key;
alter table ledger_entries add constraint ledger_entries_idempotency_key_account_key
  unique (idempotency_key, account);
