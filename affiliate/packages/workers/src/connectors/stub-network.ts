/**
 * StubNetworkConnector — a fake affiliate network implementing the Connector
 * contract for local development and demos.
 *
 * What it simulates:
 *   - tracked link creation against the fake merchant stubmart.example;
 *   - purchases via simulatePurchase(), which stand in for real provider
 *     webhooks/reports;
 *   - HMAC-signed webhook ingestion via handleWebhook();
 *   - conversion polling via fetchConversions();
 *   - reconciliation export via exportReconciliation().
 *
 * What it does NOT do:
 *   - persist anything durably: the purchase store is a MODULE-LEVEL ARRAY.
 *     It is EPHEMERAL — a process restart loses every simulated purchase.
 *     Never use this connector for anything beyond local demos.
 *   - perform real attribution: returned_click_ref values are echoed tokens
 *     minted by simulatePurchase(); matching happens in the provider-events
 *     worker against the clicks table.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  CapabilityError,
  assertMinorUnits,
  type Connector,
  type ConnectorCapabilities,
  type MinorUnits,
  type ProviderConversionStatus,
  type RawConversion,
  type ReconciliationLine,
  type TrackedLink,
  type TrackedLinkRequest,
} from '@paparazzi/shared';
import {
  stubCapabilities,
  stubOffers,
  type OfferFixture,
} from './fixtures';

const STUB_PROVIDER_ACCOUNT_ID = 'stub-acct-1';
/** Flat 8% commission, in basis points (800 bps = 8%). Demo rate, not a merchant term. */
const STUB_COMMISSION_BPS = 800;

interface StoredPurchase {
  conversion: RawConversion;
  storedAt: string;
}

/**
 * EPHEMERAL in-memory purchase store. Lost on process restart. This is
 * deliberate: the stub exists for the local demo flow, not as a system of
 * record. Production connectors read provider reports/APIs instead.
 */
const purchases: StoredPurchase[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`webhook payload missing required field: ${field}`);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  return typeof value === 'string' ? value : null;
}

function requiredMinorUnits(body: Record<string, unknown>, field: string): MinorUnits {
  const value = body[field];
  // assertMinorUnits takes a number; narrow first so misuse fails loudly.
  if (typeof value !== 'number') {
    throw new Error(`webhook payload field ${field} must be a number`);
  }
  assertMinorUnits(value);
  return value;
}

/**
 * Validate an unknown webhook body into a RawConversion.
 * (Duplicated from the provider-events worker's parser; the canonical home
 * for this helper is @paparazzi/shared — see ASSUMPTIONS.md.)
 */
function parseWebhookConversion(body: unknown): RawConversion {
  if (!isRecord(body)) {
    throw new Error('webhook payload must be a JSON object');
  }
  const providerRevision = body['provider_revision'];
  if (providerRevision !== undefined && typeof providerRevision !== 'number') {
    throw new Error('webhook payload field provider_revision must be a number when present');
  }
  return {
    provider_account_id: requiredString(body, 'provider_account_id'),
    source_transaction_id: requiredString(body, 'source_transaction_id'),
    line_id: optionalString(body, 'line_id'),
    returned_click_ref: optionalString(body, 'returned_click_ref'),
    currency: requiredString(body, 'currency'),
    eligible_value_minor: requiredMinorUnits(body, 'eligible_value_minor'),
    commission_minor: requiredMinorUnits(body, 'commission_minor'),
    provider_status: requiredString(body, 'provider_status'),
    provider_revision: typeof providerRevision === 'number' ? providerRevision : undefined,
    occurred_at: requiredString(body, 'occurred_at'),
    received_at: requiredString(body, 'received_at'),
    raw: body['raw'],
  };
}

function toReconciliationLine(conversion: RawConversion): ReconciliationLine {
  return {
    provider_account_id: conversion.provider_account_id,
    source_transaction_id: conversion.source_transaction_id,
    line_id: conversion.line_id,
    currency: conversion.currency,
    eligible_value_minor: conversion.eligible_value_minor,
    commission_minor: conversion.commission_minor,
    provider_status: conversion.provider_status,
    occurred_at: conversion.occurred_at,
  };
}

export class StubNetworkConnector implements Connector {
  readonly name = 'stub-network';

  async discoverCapabilities(): Promise<ConnectorCapabilities> {
    return { ...stubCapabilities };
  }

  async validateUrl(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return { ok: false, reason: 'not a valid URL' };
    }
    // NOTE: a strict production check would require the hostname to equal
    // 'stubmart.example' or be a proper subdomain of it; a bare endsWith
    // also matches 'evilstubmart.example'. Kept literal per the build spec —
    // see ASSUMPTIONS.md.
    if (hostname.endsWith('stubmart.example')) {
      return { ok: true };
    }
    return { ok: false, reason: `host '${hostname}' is not a StubMart domain` };
  }

  async createTrackedLink(req: TrackedLinkRequest): Promise<TrackedLink> {
    const subId = randomUUID();
    return {
      url: `https://stubmart.example/p/${req.offer_id}?subid=${subId}`,
      click_ref_field: 'subid',
      // NOTE: in production the API mints an opaque token bound to
      // publisher/property/placement/offer/effective contract and the
      // redirect service records it as the click's click_id. The stub is
      // stateless, so it echoes placement_id as the token; the demo flow
      // passes the subid value (the click reference) to simulatePurchase().
      token: req.placement_id,
    };
  }

  async fetchConversions(sinceISO: string): Promise<RawConversion[]> {
    const since = new Date(sinceISO).getTime();
    return purchases
      .filter((p) => new Date(p.conversion.occurred_at).getTime() >= since)
      .map((p) => p.conversion);
  }

  normaliseStatus(providerStatus: string): ProviderConversionStatus {
    const map: Record<string, ProviderConversionStatus> = {
      APPROVED: 'approved',
      DECLINED: 'declined',
      PENDING: 'pending',
    };
    return map[providerStatus] ?? 'pending';
  }

  async exportReconciliation(range: { from: string; to: string }): Promise<ReconciliationLine[]> {
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    return purchases
      .filter((p) => {
        const t = new Date(p.conversion.occurred_at).getTime();
        return t >= from && t < to;
      })
      .map((p) => toReconciliationLine(p.conversion));
  }

  /**
   * Typed capability error demo: the stub has no product feed, so product
   * ingestion is explicitly unsupported rather than silently broken.
   */
  async ingestProducts(): Promise<never> {
    throw new CapabilityError('ingestProducts');
  }

  async refreshOffers(ids: string[]): Promise<OfferFixture[]> {
    const wanted = new Set(ids);
    return stubOffers.filter((offer) => wanted.has(offer.offer_id));
  }

  /**
   * Verify an HMAC-SHA256 hex signature over the raw request body and parse
   * the JSON body into a RawConversion.
   *
   * The secret comes from STUB_WEBHOOK_SECRET (env) — never hardcoded.
   * Comparison uses timingSafeEqual. Throws Error('invalid webhook
   * signature') on mismatch; throws on missing secret, bad JSON, or missing
   * required fields.
   */
  handleWebhook(rawBody: string, signatureHeader: string): RawConversion {
    const secret = process.env.STUB_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('STUB_WEBHOOK_SECRET is not configured');
    }
    const hex = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice('sha256='.length)
      : signatureHeader;
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(hex, 'hex');
    } catch {
      throw new Error('invalid webhook signature');
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new Error('invalid webhook signature');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      throw new Error('webhook body is not valid JSON');
    }
    return parseWebhookConversion(parsed);
  }

  /**
   * Build a fake approved purchase for the local demo of the webhook flow:
   * simulatePurchase() -> sign body -> handleWebhook() -> enqueue on
   * 'provider-events' -> provider-events worker normalises it.
   *
   * @param linkToken the click reference to echo back as returned_click_ref
   *   (in the demo this is the `subid` value minted by createTrackedLink).
   * @param amountMinor eligible sale value in integer minor units (paise).
   */
  simulatePurchase(linkToken: string, amountMinor: number): RawConversion {
    assertMinorUnits(amountMinor);
    if (!linkToken) {
      throw new Error('linkToken is required');
    }
    const commissionMinor = Math.floor((amountMinor * STUB_COMMISSION_BPS) / 10_000);
    assertMinorUnits(commissionMinor);
    const now = new Date().toISOString();
    const conversion: RawConversion = {
      provider_account_id: STUB_PROVIDER_ACCOUNT_ID,
      source_transaction_id: randomUUID(),
      line_id: null,
      returned_click_ref: linkToken,
      currency: 'INR',
      eligible_value_minor: amountMinor,
      commission_minor: commissionMinor,
      provider_status: 'APPROVED',
      occurred_at: now,
      received_at: now,
      raw: { simulated: true, link_token: linkToken },
    };
    purchases.push({ conversion, storedAt: new Date().toISOString() });
    return conversion;
  }
}

/** Test/demo helper: inspect the ephemeral purchase store. */
export function __stubPurchases(): readonly RawConversion[] {
  return purchases.map((p) => p.conversion);
}

/** Test/demo helper: clear the ephemeral purchase store. */
export function __clearStubPurchases(): void {
  purchases.length = 0;
}
