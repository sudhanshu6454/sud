-- Paparazzi Affiliate Commerce Platform — phase-3 pilot hardening (v3)
-- Applies on top of 0002_money_loop.sql. Money stays bigint minor units.
--
-- 1. Publisher onboarding state machine.
--    application -> identity_review -> property_verification ->
--    programme_eligibility -> contract -> active
--    POST /v1/links refuses to mint monetised links for publishers whose
--    onboarding_state is not 'active' (403 PUBLISHER_NOT_ACTIVE).
--    The legacy `status` column (pending/approved/suspended) is kept for
--    compatibility and is not the minting gate.
alter table publishers
  add column onboarding_state text not null default 'application';
alter table publishers
  add constraint publishers_onboarding_state_check
  check (onboarding_state in (
    'application', 'identity_review', 'property_verification',
    'programme_eligibility', 'contract', 'active'
  ));
create index idx_publishers_onboarding on publishers(org_id, onboarding_state);

-- 2. Dispute / support tickets for missing commission.
--    A ticket may reference a conversion (wrong_amount / unattributed_click)
--    or NO conversion at all (missing_commission: the publisher believes a
--    sale happened that the provider never reported). A ticket alone never
--    creates a payable sale — resolution to 'resolved' requires
--    provider-side verification (enforced by the API, not just policy).
alter table disputes alter column conversion_id drop not null;
alter table disputes
  add column kind text not null default 'missing_commission'
  check (kind in ('missing_commission', 'wrong_amount', 'unattributed_click', 'other'));
alter table disputes
  add column publisher_id uuid references publishers(id);
alter table disputes
  add column subject text not null default '';
alter table disputes
  add column claim_ref text;
alter table disputes
  add column resolution_note text;
alter table disputes
  add column resolved_by uuid references users(id);
alter table disputes
  add column resolved_at timestamptz;
create index idx_disputes_org_status on disputes(org_id, status);

-- 3. Contracts: effective-dating discipline.
--    No column changes: version/effective_from/status already exist.
--    Enforced by the contract-versioning API (POST /v1/contracts):
--    new versions are created as 'draft' with version = max + 1 and an
--    effective_from not earlier than the previous version's; approval is a
--    separate network_admin step. Ledger posting uses the latest approved
--    contract whose effective_from is null or in the past, and every posted
--    conversion keeps its contract_version_id snapshot forever.
