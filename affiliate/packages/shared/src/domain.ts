import type { LedgerAccount } from './ledger.js';

/**
 * Money in integer minor units (paise for INR). Never floats.
 *
 * NEGATIVES ARE REJECTED: `assertMinorUnits` throws for negative values.
 * Deltas that would be negative are instead expressed as positive amounts
 * on the opposite ledger side (e.g. a reversal credits merchant_receivable
 * rather than debiting with a negative number).
 */
export type MinorUnits = number;

export function assertMinorUnits(n: number): asserts n is MinorUnits {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`MinorUnits must be a finite integer, got ${n}`);
  }
  if (n < 0) {
    throw new Error(
      `MinorUnits must be non-negative; express deductions as positive amounts on the opposite ledger side (got ${n})`,
    );
  }
}

/**
 * Entity interfaces mirroring `db/migrations/0001_core.sql`.
 * IDs are UUID strings; timestamps are ISO 8601 strings as returned by `pg`;
 * money columns are {@link MinorUnits}.
 */

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export type MembershipRole =
  | 'network_admin'
  | 'editor'
  | 'publisher_owner'
  | 'publisher_analyst'
  | 'merchant_manager'
  | 'finance_operator'
  | 'finance_approver';

export interface Membership {
  user_id: string;
  org_id: string;
  role: MembershipRole;
  created_at: string;
}

export type PublisherStatus = 'pending' | 'approved' | 'suspended';

export interface Publisher {
  id: string;
  org_id: string;
  legal_name: string;
  country: string;
  status: PublisherStatus;
  created_at: string;
}

export type PropertyStatus = 'pending' | 'approved' | 'suspended';

export interface Property {
  id: string;
  org_id: string;
  publisher_id: string;
  platform: string;
  external_account_id: string;
  canonical_url: string | null;
  status: PropertyStatus;
  created_at: string;
}

export interface Verification {
  id: string;
  org_id: string;
  property_id: string;
  method: string;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Merchant {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
}

export type ProgrammeStatus = 'draft' | 'active' | 'paused' | 'blocked';

export interface Programme {
  id: string;
  org_id: string;
  merchant_id: string;
  connector: string;
  name: string;
  status: ProgrammeStatus;
  attribution_window_days: number;
  validation_delay_days: number;
  returns_window_days: number;
  commission_basis: string;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
}

export interface ProgrammeCapability {
  programme_id: string;
  countries: string[];
  currency: string;
  allowed_domains: string[];
  subpublisher_allowed: boolean;
  policy_url: string | null;
  next_review_date: string | null;
}

export interface Product {
  id: string;
  org_id: string;
  gtin: string | null;
  brand: string;
  model: string;
  category: string;
  created_at: string;
}

export interface Variant {
  id: string;
  org_id: string;
  product_id: string;
  size_text: string | null;
  colour: string | null;
  merchant_sku: string | null;
  created_at: string;
}

export type OfferStatus = 'active' | 'stale' | 'revoked';

export interface Offer {
  id: string;
  org_id: string;
  variant_id: string;
  programme_id: string;
  merchant_id: string;
  price_minor: MinorUnits;
  currency: string;
  stock_status: string;
  offer_url: string;
  fresh_until: string;
  status: OfferStatus;
  created_at: string;
}

export interface Asset {
  id: string;
  org_id: string;
  storage_key: string;
  license: string;
  territory: string | null;
  expires_at: string | null;
  created_at: string;
}

export type LookStatus = 'draft' | 'in_review' | 'ready' | 'published' | 'paused' | 'withdrawn';

export interface Look {
  id: string;
  org_id: string;
  title: string;
  locale: string;
  category: string | null;
  status: LookStatus;
  published_at: string | null;
  created_at: string;
}

export type MatchType = 'exact' | 'similar';

export interface LookItem {
  id: string;
  org_id: string;
  look_id: string;
  asset_id: string;
  variant_id: string;
  match_type: MatchType | null;
  evidence: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  org_id: string;
  publisher_id: string;
  programme_id: string;
  name: string;
  created_at: string;
}

export interface Placement {
  id: string;
  org_id: string;
  campaign_id: string;
  property_id: string;
  channel: string;
  placement_key: string;
  created_at: string;
}

export type LinkStatus = 'active' | 'paused';

export interface Link {
  id: string;
  org_id: string;
  token: string;
  placement_id: string;
  offer_id: string;
  contract_version_id: string | null;
  route_signature: string;
  status: LinkStatus;
  created_at: string;
}

export interface Click {
  id: string;
  org_id: string;
  link_id: string;
  click_id: string;
  occurred_at: string;
  context: unknown;
}

export type ConversionStatus = 'received' | 'pending' | 'approved' | 'declined';

export interface Conversion {
  id: string;
  org_id: string;
  programme_id: string;
  provider_account_id: string;
  source_transaction_id: string;
  line_id: string | null;
  returned_click_ref: string | null;
  /**
   * FK to clicks. NULL means the conversion sits in suspense / is unattributed —
   * it must NEVER be guessed or back-filled by heuristics.
   */
  click_id: string | null;
  currency: string;
  eligible_value_minor: MinorUnits;
  commission_minor: MinorUnits;
  provider_status: string;
  provider_revision: number;
  status: ConversionStatus;
  occurred_at: string;
  received_at: string;
  raw: unknown;
}

export type AdjustmentKind = 'reversal' | 'correction';

export interface Adjustment {
  id: string;
  org_id: string;
  conversion_id: string;
  kind: AdjustmentKind;
  commission_delta_minor: MinorUnits;
  reason: string | null;
  created_at: string;
}

export interface Contract {
  id: string;
  org_id: string;
  publisher_id: string;
  programme_id: string;
  version: number;
  publisher_share_bps: number;
  payout_threshold_minor: MinorUnits;
  status: string;
  effective_from: string | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  org_id: string;
  currency: string;
  account: LedgerAccount;
  debit_minor: MinorUnits;
  credit_minor: MinorUnits;
  conversion_id: string | null;
  adjustment_id: string | null;
  contract_version_id: string | null;
  publisher_id: string | null;
  idempotency_key: string;
  memo: string | null;
  created_at: string;
}

export type SettlementStatus = 'open' | 'reconciled' | 'disputed';

export interface Settlement {
  id: string;
  org_id: string;
  programme_id: string;
  statement_ref: string | null;
  period_start: string | null;
  period_end: string | null;
  status: SettlementStatus;
  created_at: string;
}

export type PayoutBatchStatus = 'draft' | 'pending_approval' | 'approved' | 'processing' | 'paid' | 'failed';

export interface PayoutBatch {
  id: string;
  org_id: string;
  currency: string;
  status: PayoutBatchStatus;
  prepared_by: string | null;
  approved_by: string | null;
  idempotency_key: string;
  created_at: string;
}

export interface PayoutItem {
  id: string;
  payout_batch_id: string;
  publisher_id: string;
  amount_minor: MinorUnits;
  currency: string;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  org_id: string;
  subject_ref: string;
  purpose: string;
  version: string;
  granted_at: string | null;
  withdrawn_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  org_id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  created_at: string;
}

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected';

export interface Dispute {
  id: string;
  org_id: string;
  conversion_id: string;
  status: DisputeStatus;
  evidence: unknown;
  created_at: string;
}

export interface OutboxRow {
  id: string;
  org_id: string;
  event_type: string;
  payload: unknown;
  payload_hash: string;
  occurred_at: string;
  published_at: string | null;
}
