import type { MinorUnits } from './domain.js';

/**
 * Thrown by connector implementations when a method is not supported by the
 * underlying provider. Callers must catch this and degrade gracefully
 * (e.g. mark the programme capability as unavailable) rather than failing.
 */
export class CapabilityError extends Error {
  readonly code = 'UNSUPPORTED_METHOD' as const;
  readonly method: string;

  constructor(method: string, detail?: string) {
    super(`Connector does not support method ${method}${detail ? `: ${detail}` : ''}`);
    this.name = 'CapabilityError';
    this.method = method;
  }
}

/** What a provider/programme integration can and cannot do. */
export interface ConnectorCapabilities {
  countries: string[];
  currencies: string[];
  supportsSubpublisher: boolean;
  attributionWindowDays: number;
  reportingLatencyHours: number;
  returnsWindowDays: number;
  itemLevelData: boolean;
  socialAppPermissions: string[];
}

export interface TrackedLinkRequest {
  offer_id: string;
  publisher_id: string;
  property_id: string;
  placement_id: string;
}

export interface TrackedLink {
  /** Fully-formed redirect URL served by the redirect service. */
  url: string;
  /** Query param / path field the provider echoes back for attribution. */
  click_ref_field: string;
  /** Opaque token embedded in `url` (maps to `links.token`). */
  token: string;
}

/** Platform-normalised conversion lifecycle. */
export type ConversionStatus = 'pending' | 'approved' | 'declined' | 'reversed';

/**
 * A conversion as fetched from the provider, before platform normalisation.
 * Money is already expressed in integer minor units of `currency`.
 */
export interface RawConversion {
  provider_account_id: string;
  source_transaction_id: string;
  line_id: string | null;
  returned_click_ref: string | null;
  currency: string;
  eligible_value_minor: MinorUnits;
  commission_minor: MinorUnits;
  /** Raw provider-side status string; see `normaliseStatus`. */
  provider_status: string;
  provider_revision?: number;
  occurred_at: string;
  received_at: string;
  /** Full provider payload for audit / re-normalisation. */
  raw: unknown;
}

/**
 * One line of a provider settlement statement, used by finance to reconcile
 * provider-reported figures against the platform ledger.
 */
export interface ReconciliationLine {
  provider_account_id: string;
  source_transaction_id: string;
  line_id: string | null;
  currency: string;
  eligible_value_minor: MinorUnits;
  commission_minor: MinorUnits;
  provider_status: string;
  occurred_at: string;
}

/** Page of catalogue products returned by `ingestProducts`. */
export interface ProductPage {
  products: unknown[];
  nextCursor?: string;
}

/**
 * Adapter every affiliate-provider integration must implement.
 * Implementations may throw {@link CapabilityError} from any method the
 * provider does not support.
 */
export interface Connector {
  discoverCapabilities(): Promise<ConnectorCapabilities>;
  validateUrl(url: string): Promise<{ ok: boolean; reason?: string }>;
  createTrackedLink(req: TrackedLinkRequest): Promise<TrackedLink>;
  fetchConversions(sinceISO: string): Promise<RawConversion[]>;
  normaliseStatus(providerStatus: string): ConversionStatus;
  exportReconciliation(range: { from: string; to: string }): Promise<ReconciliationLine[]>;
  ingestProducts(cursor?: string): Promise<ProductPage>;
  refreshOffers(offerIds: string[]): Promise<unknown[]>;
}
