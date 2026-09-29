/**
 * Shared conversion ingestion — ONE money path, two ingestion shapes.
 *
 * Both the provider webhook (`POST /v1/integrations/:connector/events`) and
 * the file-based CSV connector (`POST /v1/integrations/csv/uploads`) funnel
 * every conversion row/event through `ingestConversionEvent`. The shapes
 * differ (JSON body vs CSV row), but the state machine is identical:
 *
 *   Attribution: `returned_click_ref` is matched against `clicks.click_id`.
 *   A miss is NOT an error — the conversion is stored with `click_id = NULL`
 *   (suspense). Attribution is never guessed.
 *
 *   Tracking-ID attribution (Amazon.in Associates, `resolveAttribution`): a
 *   row that reports the tracking ID it was earned under (`trackingRef`) and
 *   carries no known click is attributed to the ONE placement that tracking
 *   ID is mapped to (amazon_tracking_ids; unique per account) — only when
 *   the mapping began on or before the row's date and the placement's
 *   campaign is for the row's programme. It is stored as
 *   `conversions.placement_id` with `click_id` NULL, and the ledger walks
 *   placement → campaign → publisher, the same chain a click takes after
 *   its first hop, with the same contract lookup and snapshot. An unknown
 *   tracking ID, the account's store ID (shared by every unmapped
 *   placement), a mapping younger than the sale, or a click whose own tag
 *   disagrees with the reported tracking ID → suspense, with the reason
 *   stored in `suspense_reason`. Never guessed.
 *
 *   Dedupe: `(provider_account_id, source_transaction_id, line_id)` has a
 *   nulls-not-distinct unique constraint. A repeat at the same or lower
 *   `provider_revision` is a no-op (`deduped`).
 *
 *   Revision-ordered state machine:
 *     - incoming revision <= stored revision → ignored (deduped);
 *     - higher revision → `provider_status`/`provider_revision` updated;
 *       transitions received/pending/declined → approved post the ledger
 *       (idempotent via entry keys) and snapshot `contract_version_id`;
 *       approved is NEVER downgraded — a higher-revision 'pending' is
 *       logged and ignored, a higher-revision 'declined'/'reversed'
 *       creates a reversal adjustment for the full remaining commission.
 *
 *   Approved conversions that cannot be attributed or contracted are
 *   logged and left unposted rather than posted against a guessed publisher.
 *
 *   Every state change writes the same outbox events as the webhook path:
 *   `conversion.received`, `conversion.status_changed`, `conversion.reversed`.
 *
 *   Provider paths do not cross: an Amazon.in Associates programme, or a
 *   provider_account_id that is an Amazon account's account_ref, is only
 *   ever written through the Amazon report path (connector
 *   'amazon-associates'); anything else throws
 *   CONVERSION_PROGRAMME_CONNECTOR_MISMATCH before a row is written (the CSV
 *   and webhook adapters refuse it earlier with a 422).
 *
 * The worker-side mirror (`packages/workers/src/workers/provider-events.ts`)
 * intentionally keeps its own copy — it runs off the Redis queue, not the
 * API. Do NOT change it from here.
 */
import type { FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { AMAZON_CONNECTOR, buildEnvelope } from '@paparazzi/shared';
import { getPool, tenantQuery } from './db.js';
import { postAdjustmentForReversal, postLedgerForConversion, toMinorUnits } from './finance.js';
import { amazonAccountByRef, type AmazonAccount } from './amazon/account.js';

export type InternalStatus = 'received' | 'pending' | 'approved' | 'declined';

/**
 * Provider status vocabulary → internal conversion status.
 * NOTE: the provider-side 'reversed' normalises to internal 'declined' —
 * the DB enum has no 'reversed'. A reversal's financial effect is produced
 * by the state machine (auto-reversal adjustment), never by an in-place
 * status flip.
 * TODO: delegate to connector.normaliseStatus once the registry exists.
 */
export function mapProviderStatus(raw: string): 'approved' | 'declined' | 'pending' {
  const s = raw.trim().toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'declined' || s === 'reversed') return 'declined';
  return 'pending';
}

/** Deterministic uuid for auto-reversal adjustments (retries stay idempotent). */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Normalised conversion event — the shape every ingestion entry point
 * (webhook JSON, CSV row) must produce before calling ingestConversionEvent.
 *
 * `programmeId`: the CSV path supplies it explicitly (the uploader names the
 * programme); the webhook path passes null and the programme is resolved as
 * before (click chain → single active programme for the connector).
 */
export interface ConversionIngestInput {
  connector: string;
  receivedVia: string;
  programmeId: string | null;
  providerAccountId: string;
  sourceTransactionId: string;
  lineId: string | null;
  returnedClickRef: string | null;
  /** Uppercase 3-letter ISO currency. */
  currency: string;
  eligibleValueMinor: number;
  commissionMinor: number;
  /** Raw provider status string (e.g. 'approved', 'pending', 'reversed'). */
  providerStatus: string;
  providerRevision: number;
  /** ISO datetime string. */
  occurredAt: string;
  /**
   * The tracking ID the provider reports the row was earned under (Amazon
   * Associates). Only meaningful when `providerAccountId` is an Amazon
   * account's account_ref; see resolveAttribution.
   */
  trackingRef?: string | null;
  /** The provider's item id (Amazon: the ASIN), kept for matching a later return. */
  itemRef?: string | null;
  /** Extra evidence stored in conversions.raw next to connector / received_via. */
  rawExtra?: Record<string, unknown>;
}

export type SuspenseReason =
  | 'TRACKING_ID_UNMAPPED'
  | 'TRACKING_ID_IS_STORE_DEFAULT'
  | 'TRACKING_ID_MAPPED_AFTER_SALE'
  | 'ATTRIBUTION_CONFLICT';

export interface AttributionResult {
  /** clicks.id (pk) when attributed to a click. */
  clickPk: string | null;
  /** placements.id when attributed through a tracking-ID mapping (never together with clickPk). */
  placementId: string | null;
  /** Why the row stays unattributed; null when attributed, or when the old derived reasons apply. */
  suspenseReason: SuspenseReason | null;
}

export type IngestOutcome =
  | { kind: 'created'; conversionId: string; status: InternalStatus; ledger: 'posted' | 'skipped' }
  | { kind: 'deduped'; conversionId: string; status: InternalStatus }
  | { kind: 'status_changed'; conversionId: string; status: InternalStatus; ledger: 'posted' | 'skipped' }
  | {
      kind: 'auto_reversed';
      conversionId: string;
      status: 'approved';
      autoReversed: boolean;
      adjustmentId: string | null;
      ledger: 'posted' | 'skipped';
    };

export type IngestLog = Pick<FastifyRequest['log'], 'info'>;

interface StoredConversion {
  id: string;
  status: string;
  provider_revision: number;
  commission_minor: string;
  currency: string;
  contract_version_id: string | null;
  click_id: string | null;
  placement_id: string | null;
  programme_id: string;
}

async function findConversion(
  orgId: string,
  providerAccountId: string,
  sourceTransactionId: string,
  lineId: string | null,
): Promise<StoredConversion | null> {
  const { rows } = await tenantQuery<StoredConversion>(
    orgId,
    `select id, status, provider_revision,
            commission_minor::text as commission_minor, currency,
            contract_version_id, click_id, placement_id, programme_id
       from conversions
      where org_id = $1
        and provider_account_id = $2
        and source_transaction_id = $3
        and (line_id = $4 or (line_id is null and $4::text is null))`,
    [providerAccountId, sourceTransactionId, lineId],
  );
  return rows[0] ?? null;
}

/** Commission not yet reversed by prior reversal adjustments. */
async function unreversedRemainder(
  orgId: string,
  conversionId: string,
  commissionMinor: string,
): Promise<number> {
  const { rows } = await tenantQuery<{ reversed_minor: string | null }>(
    orgId,
    `select sum(commission_delta_minor)::text as reversed_minor
       from adjustments
      where org_id = $1 and conversion_id = $2 and kind = 'reversal'`,
    [conversionId],
  );
  return Math.max(toMinorUnits(commissionMinor) - Number(rows[0]?.reversed_minor ?? 0), 0);
}

async function writeOutbox(
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>,
  source = 'api',
): Promise<void> {
  const envelope = buildEnvelope({ source, event_type: eventType, payload });
  await tenantQuery(
    orgId,
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
}

/**
 * Creates a reversal adjustment for the full unreversed remainder and posts
 * its mirror entries. The adjustment id is derived deterministically from
 * (conversion, revision) so retried provider notifications stay idempotent.
 */
async function autoReverse(
  orgId: string,
  stored: StoredConversion,
  incomingRevision: number,
  rawProviderStatus: string,
  log: IngestLog,
): Promise<{ adjustment_id: string | null; ledger: 'posted' | 'skipped' }> {
  const remainder = await unreversedRemainder(orgId, stored.id, stored.commission_minor);
  if (remainder <= 0) {
    log.info(
      { conversionId: stored.id, incomingRevision },
      'higher-revision declined after approval but nothing remains to reverse',
    );
    return { adjustment_id: null, ledger: 'skipped' };
  }
  const adjustmentId = deterministicUuid(`auto-reversal:${stored.id}:${incomingRevision}`);
  await tenantQuery(
    orgId,
    `insert into adjustments (id, org_id, conversion_id, kind, commission_delta_minor, reason)
     values ($2, $1, $3, 'reversal', $4, $5)
     on conflict (id) do nothing`,
    [
      adjustmentId,
      stored.id,
      String(remainder),
      `provider reported '${rawProviderStatus}' at revision ${incomingRevision} after approval`,
    ],
  );
  const ledger = await postAdjustmentForReversal(getPool(), {
    adjustmentId,
    conversionId: stored.id,
  });
  if (ledger === 'skipped') {
    log.info(
      { adjustmentId, conversionId: stored.id },
      'auto-reversal recorded without ledger entries: original conversion was never posted',
    );
  }
  return { adjustment_id: adjustmentId, ledger };
}

/**
 * Resolve the programme for a webhook event: click chain first, then the
 * single active programme for the connector in the org. Returns null when
 * neither resolves (caller fails closed with 422).
 */
async function resolveWebhookProgramme(
  orgId: string,
  connector: string,
  clickPk: string | null,
): Promise<string | null> {
  let programmeId: string | null = null;
  if (clickPk) {
    const via = await tenantQuery<{ programme_id: string }>(
      orgId,
      `select o.programme_id as programme_id
         from clicks cl
         join links l on l.id = cl.link_id and l.org_id = $1
         join offers o on o.id = l.offer_id and o.org_id = $1
        where cl.id = $2 and cl.org_id = $1
        limit 1`,
      [clickPk],
    );
    programmeId = via.rows[0]?.programme_id ?? null;
  }
  if (!programmeId) {
    const single = await tenantQuery<{ id: string }>(
      orgId,
      `select id from programmes
        where org_id = $1 and connector = $2 and status = 'active'`,
      [connector],
    );
    programmeId = single.rows.length === 1 ? (single.rows[0]?.id ?? null) : null;
  }
  return programmeId;
}

/** Exact click lookup: `clicks.click_id = ref` (globally unique), or null. */
async function clickByRef(orgId: string, ref: string | null): Promise<string | null> {
  if (!ref) return null;
  const hit = await tenantQuery<{ id: string }>(
    orgId,
    `select id from clicks where org_id = $1 and click_id = $2`,
    [ref],
  );
  return hit.rows[0]?.id ?? null;
}

/**
 * The placement a tracking ID is mapped to for this account and programme,
 * or why there is none. Exact equality only; (account, tracking ID) is
 * unique, so there is at most one row. The mapping must have begun on or
 * before the sale (`effective_from <= occurredAt`).
 */
export async function placementForTrackingId(
  orgId: string,
  account: AmazonAccount,
  trackingRef: string,
  occurredAt: string,
): Promise<{ placementId: string } | { suspenseReason: SuspenseReason }> {
  const ref = trackingRef.trim().toLowerCase();
  if (ref === account.store_id) return { suspenseReason: 'TRACKING_ID_IS_STORE_DEFAULT' };
  const { rows } = await tenantQuery<{ placement_id: string; effective_from: string | Date }>(
    orgId,
    `select t.placement_id as placement_id, t.effective_from as effective_from
       from amazon_tracking_ids t
       join placements pl on pl.id = t.placement_id and pl.org_id = $1
       join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
      where t.org_id = $1 and t.account_id = $2 and t.tracking_id = $3 and ca.programme_id = $4`,
    [account.id, ref, account.programme_id],
  );
  const hit = rows[0];
  if (!hit || rows.length !== 1) return { suspenseReason: 'TRACKING_ID_UNMAPPED' };
  if (new Date(hit.effective_from).getTime() > new Date(occurredAt).getTime()) {
    return { suspenseReason: 'TRACKING_ID_MAPPED_AFTER_SALE' };
  }
  return { placementId: hit.placement_id };
}

/**
 * Attribution for one conversion, from data only (shared by ingest and the
 * suspense retry, so both apply the same rules):
 *
 *   1. `returnedClickRef` that is a known click → that click (as before).
 *      With a `trackingRef` (Amazon), the click's own link must be of this
 *      account's programme and its placement's tag (its tracking ID, else
 *      the store ID) must equal the reported tracking ID; otherwise
 *      ATTRIBUTION_CONFLICT → suspense.
 *   2. No known click, a `trackingRef`, an Amazon account for
 *      `providerAccountId` → placementForTrackingId.
 *   3. Anything else → unattributed (suspense); `suspenseReason` null keeps
 *      the reasons derived as before (NO_CLICK_REF / CLICK_REF_UNMATCHED).
 */
export async function resolveAttribution(
  orgId: string,
  input: {
    providerAccountId: string;
    programmeId: string | null;
    returnedClickRef: string | null;
    trackingRef?: string | null;
    occurredAt: string;
  },
): Promise<AttributionResult> {
  const clickPk = await clickByRef(orgId, input.returnedClickRef);
  const trackingRef = input.trackingRef?.trim() ? input.trackingRef.trim().toLowerCase() : null;
  if (!trackingRef) return { clickPk, placementId: null, suspenseReason: null };

  const account = await amazonAccountByRef(orgId, input.providerAccountId);
  if (!account || (input.programmeId !== null && input.programmeId !== account.programme_id)) {
    // A tracking ID means nothing without the account it belongs to.
    return clickPk
      ? { clickPk, placementId: null, suspenseReason: null }
      : { clickPk: null, placementId: null, suspenseReason: 'TRACKING_ID_UNMAPPED' };
  }

  if (clickPk) {
    const via = await tenantQuery<{ placement_id: string; programme_id: string }>(
      orgId,
      `select l.placement_id as placement_id, o.programme_id as programme_id
         from clicks cl
         join links l on l.id = cl.link_id and l.org_id = $1
         join offers o on o.id = l.offer_id and o.org_id = $1
        where cl.org_id = $1 and cl.id = $2`,
      [clickPk],
    );
    const hop = via.rows[0];
    if (!hop || hop.programme_id !== account.programme_id) {
      return { clickPk: null, placementId: null, suspenseReason: 'ATTRIBUTION_CONFLICT' };
    }
    const mapped = await tenantQuery<{ tracking_id: string }>(
      orgId,
      `select tracking_id from amazon_tracking_ids
        where org_id = $1 and account_id = $2 and placement_id = $3`,
      [account.id, hop.placement_id],
    );
    const expectedTag = mapped.rows[0]?.tracking_id ?? account.store_id;
    if (expectedTag !== trackingRef) {
      return { clickPk: null, placementId: null, suspenseReason: 'ATTRIBUTION_CONFLICT' };
    }
    return { clickPk, placementId: null, suspenseReason: null };
  }

  const byTracking = await placementForTrackingId(orgId, account, trackingRef, input.occurredAt);
  if ('placementId' in byTracking) return { clickPk: null, placementId: byTracking.placementId, suspenseReason: null };
  return { clickPk: null, placementId: null, suspenseReason: byTracking.suspenseReason };
}

/**
 * True when a programme or a provider account belongs to the Amazon.in
 * Associates report path, which only connector 'amazon-associates' may write
 * (the report import's exact-return and idempotency rules must not be
 * bypassed, and its future keys must not be claimed, through the generic CSV
 * or webhook adapters).
 */
export async function isAmazonReportPath(
  orgId: string,
  ref: { programmeId?: string | null; providerAccountId?: string | null },
): Promise<boolean> {
  if (ref.programmeId) {
    const { rows } = await tenantQuery<{ connector: string }>(
      orgId,
      `select connector from programmes where org_id = $1 and id = $2`,
      [ref.programmeId],
    );
    if (rows[0]?.connector === AMAZON_CONNECTOR) return true;
  }
  if (ref.providerAccountId) {
    if (await amazonAccountByRef(orgId, ref.providerAccountId)) return true;
  }
  return false;
}

/**
 * Run one conversion event/row through the shared state machine.
 * Returns an outcome the caller maps to its transport response.
 */
export async function ingestConversionEvent(
  orgId: string,
  input: ConversionIngestInput,
  log: IngestLog,
): Promise<IngestOutcome> {
  const {
    connector,
    receivedVia,
    providerAccountId,
    sourceTransactionId,
    lineId,
    returnedClickRef,
    currency,
    eligibleValueMinor,
    commissionMinor,
    providerStatus,
    providerRevision,
    occurredAt,
  } = input;
  const newStatus = mapProviderStatus(providerStatus);

  // 1) Attribution — a click, a tracking-ID placement, or neither (suspense). Never guessed.
  const attribution = await resolveAttribution(orgId, {
    providerAccountId,
    programmeId: input.programmeId,
    returnedClickRef,
    trackingRef: input.trackingRef ?? null,
    occurredAt,
  });
  const clickPk = attribution.clickPk;
  const placementPk = attribution.placementId;

  // 2) Programme: explicit for CSV uploads, resolved for webhook events.
  const programmeId = input.programmeId ?? (await resolveWebhookProgramme(orgId, connector, clickPk));
  if (!programmeId) {
    throw new Error('CONVERSION_PROGRAMME_UNKNOWN');
  }
  // 2b) The Amazon report path is the only writer of Amazon programmes and accounts.
  if (connector !== AMAZON_CONNECTOR && (await isAmazonReportPath(orgId, { programmeId, providerAccountId }))) {
    throw new Error('CONVERSION_PROGRAMME_CONNECTOR_MISMATCH');
  }

  // 3) Insert the conversion (dedupe on provider natural key).
  const conversionId = randomUUID();
  const inserted = await tenantQuery<{ id: string }>(
    orgId,
    `insert into conversions
       (id, org_id, programme_id, provider_account_id, source_transaction_id,
        line_id, returned_click_ref, click_id, currency, eligible_value_minor,
        commission_minor, provider_status, provider_revision, status,
        occurred_at, received_at, raw,
        placement_id, returned_tracking_ref, item_ref, suspense_reason)
     values
       ($2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), $16::jsonb,
        $17, $18, $19, $20)
     -- Bare ON CONFLICT (no arbiter): pg-mem does not honour multi-column
     -- arbiters, so the explicit column list is intentionally omitted. Safe:
     -- the only other unique here is the uuid pkey and the row is re-selected
     -- below, so a skip always resolves to the canonical row.
     on conflict do nothing
     returning id`,
    [
      conversionId,
      programmeId,
      providerAccountId,
      sourceTransactionId,
      lineId,
      returnedClickRef,
      clickPk,
      currency,
      String(eligibleValueMinor),
      String(commissionMinor),
      providerStatus,
      providerRevision,
      newStatus,
      occurredAt,
      JSON.stringify({ ...(input.rawExtra ?? {}), connector, received_via: receivedVia }),
      placementPk,
      input.trackingRef?.trim() ? input.trackingRef.trim().toLowerCase() : null,
      input.itemRef ?? null,
      clickPk || placementPk ? null : attribution.suspenseReason,
    ],
  );
  if (inserted.rows.length > 0) {
    // Fresh conversion — post the ledger when approved.
    let ledger: 'posted' | 'skipped' = 'skipped';
    if (newStatus === 'approved') {
      ledger = await postLedgerForConversion(getPool(), {
        id: conversionId,
        org_id: orgId,
        programme_id: programmeId,
        click_id: clickPk,
        placement_id: placementPk,
        currency,
        commission_minor: String(commissionMinor),
      });
      if (ledger === 'skipped') {
        log.info(
          { conversionId, clickPk, placementPk },
          'approved conversion left unposted: unattributable or no approved contract',
        );
      }
    }

    await writeOutbox(orgId, 'conversion.received', {
      conversion_id: conversionId,
      org_id: orgId,
      connector,
      status: newStatus,
      click_id: clickPk,
      placement_id: placementPk,
      suspense_reason: clickPk || placementPk ? null : attribution.suspenseReason,
      ledger,
    });
    return { kind: 'created', conversionId, status: newStatus, ledger };
  }

  // 3b) Natural key already recorded — revision-ordered state machine.
  const stored = await findConversion(orgId, providerAccountId, sourceTransactionId, lineId);
  if (!stored) throw new Error('INTERNAL: conversion conflict could not be resolved');

  if (providerRevision <= stored.provider_revision) {
    // Same-or-older provider information: safe to ack, nothing to do.
    return { kind: 'deduped', conversionId: stored.id, status: stored.status as InternalStatus };
  }

  if (stored.status === 'approved') {
    // APPROVED IS TERMINAL for the status column — never downgrade it.
    if (newStatus === 'declined') {
      const { adjustment_id, ledger } = await autoReverse(
        orgId,
        stored,
        providerRevision,
        providerStatus,
        log,
      );
      await tenantQuery(
        orgId,
        `update conversions set provider_status = $2, provider_revision = $3
          where id = $4 and org_id = $1`,
        [providerStatus, providerRevision, stored.id],
      );
      await writeOutbox(orgId, 'conversion.reversed', {
        conversion_id: stored.id,
        org_id: orgId,
        connector,
        status: 'approved',
        auto_reversed: adjustment_id !== null,
        adjustment_id,
        provider_revision: providerRevision,
        ledger,
      });
      return {
        kind: 'auto_reversed',
        conversionId: stored.id,
        status: 'approved',
        autoReversed: adjustment_id !== null,
        adjustmentId: adjustment_id,
        ledger,
      };
    }
    // Higher-revision 'pending' (or repeated 'approved') after approval:
    // record the provider facts, keep the approval, ignore the downgrade.
    await tenantQuery(
      orgId,
      `update conversions set provider_status = $2, provider_revision = $3
        where id = $4 and org_id = $1`,
      [providerStatus, providerRevision, stored.id],
    );
    if (newStatus === 'pending') {
      log.info(
        { conversionId: stored.id, incomingRevision: providerRevision },
        "higher-revision 'pending' arrived after 'approved'; downgrade ignored",
      );
    }
    return { kind: 'deduped', conversionId: stored.id, status: 'approved' };
  }

  // stored.status is received/pending/declined — apply the transition.
  let ledger: 'posted' | 'skipped' = 'skipped';
  if (newStatus === 'approved') {
    ledger = await postLedgerForConversion(getPool(), {
      id: stored.id,
      org_id: orgId,
      programme_id: stored.programme_id,
      click_id: stored.click_id,
      placement_id: stored.placement_id,
      currency: stored.currency,
      commission_minor: stored.commission_minor,
    });
    if (ledger === 'skipped') {
      log.info(
        { conversionId: stored.id },
        'approved conversion left unposted: unattributable or no approved contract',
      );
    }
  }
  await tenantQuery(
    orgId,
    `update conversions set status = $2, provider_status = $3, provider_revision = $4
      where id = $5 and org_id = $1`,
    [newStatus, providerStatus, providerRevision, stored.id],
  );
  await writeOutbox(orgId, 'conversion.status_changed', {
    conversion_id: stored.id,
    org_id: orgId,
    connector,
    from_status: stored.status,
    to_status: newStatus,
    provider_revision: providerRevision,
    ledger,
  });
  return { kind: 'status_changed', conversionId: stored.id, status: newStatus, ledger };
}

// ---------------------------------------------------------------------------
// Returns reported as their own rows (Amazon.in Associates earnings report)
// ---------------------------------------------------------------------------

/**
 * A return / refund reported as a row of its own, not as a new revision of
 * the sale (Amazon: "Negative numbers represent returned or refunded
 * products … the record for the dispatched item and the record for its
 * return may not be on the same report"). It reverses commission on the ONE
 * approved conversion it can only belong to, through the same reversal
 * machinery as a provider reversal (adjustments + postAdjustmentForReversal
 * mirroring the ORIGINAL contract snapshot).
 */
export interface ReturnIngestInput {
  connector: string;
  programmeId: string;
  providerAccountId: string;
  /** Stable identity of the return row, built from the report's own fields. */
  returnKey: string;
  currency: string;
  trackingRef: string;
  itemRef: string;
  /** ISO datetime of the return row (its report date). */
  occurredAt: string;
  /** Commission to reverse, minor units, > 0 (the row's fee, sign dropped). */
  commissionReversalMinor: number;
  reason: string;
}

export type ReturnOutcome =
  | { kind: 'applied'; adjustmentId: string; conversionId: string; ledger: 'posted' | 'skipped' }
  | { kind: 'deduped'; adjustmentId: string; conversionId: string }
  | { kind: 'unmatched'; adjustmentId: string; reason: 'NO_CANDIDATE' | 'AMBIGUOUS'; candidates: number };

/** The adjustment id of a return row: deterministic, so a re-import is a no-op. */
export function returnAdjustmentId(providerAccountId: string, returnKey: string): string {
  return deterministicUuid(`provider-return:${providerAccountId}:${returnKey}`);
}

/** An existing return adjustment (the report import's conflict pre-pass reads it too). */
export async function findReturnAdjustment(
  orgId: string,
  adjustmentId: string,
): Promise<{ conversion_id: string; commission_delta_minor: number } | null> {
  const { rows } = await tenantQuery<{ conversion_id: string; commission_delta_minor: string }>(
    orgId,
    `select conversion_id, commission_delta_minor::text as commission_delta_minor
       from adjustments where org_id = $1 and id = $2`,
    [adjustmentId],
  );
  const r = rows[0];
  return r ? { conversion_id: r.conversion_id, commission_delta_minor: toMinorUnits(r.commission_delta_minor) } : null;
}

/**
 * Apply one return row. Matching is exact and never guessed: the candidates
 * are the org's APPROVED conversions of the same programme, provider account,
 * currency, tracking ID and item (ASIN), dated on or before the return, whose
 * unreversed commission covers the return. Exactly one candidate → a
 * reversal adjustment (deterministic id, `on conflict (id) do nothing`) and
 * its mirror entries. None or several → nothing is written except an outbox
 * `conversion.return_unmatched` event; the operator applies it to the one
 * sale they choose with `applyReturnToConversion` (the CLI's `apply-return`,
 * `amazon.sh returns`), under the same deterministic id.
 *
 * The write is atomic against concurrent returns: insertReversalWithinRemainder
 * locks the conversion row and inserts only while the reversals stay within
 * its commission (the report import also runs one file at a time per
 * account, report-import.ts).
 */
export async function ingestReturnEvent(orgId: string, input: ReturnIngestInput, log: IngestLog): Promise<ReturnOutcome> {
  if (!Number.isSafeInteger(input.commissionReversalMinor) || input.commissionReversalMinor <= 0) {
    throw new Error('ingestReturnEvent: commissionReversalMinor must be a positive integer of minor units');
  }
  const adjustmentId = returnAdjustmentId(input.providerAccountId, input.returnKey);
  const existing = await findReturnAdjustment(orgId, adjustmentId);
  if (existing) {
    if (existing.commission_delta_minor !== input.commissionReversalMinor) {
      throw new Error('RETURN_AMOUNT_CONFLICT');
    }
    return { kind: 'deduped', adjustmentId, conversionId: existing.conversion_id };
  }

  const { rows: candidates } = await tenantQuery<{ id: string; commission_minor: string }>(
    orgId,
    `select id, commission_minor::text as commission_minor
       from conversions
      where org_id = $1 and programme_id = $2 and provider_account_id = $3 and currency = $4
        and returned_tracking_ref = $5 and item_ref = $6
        and status = 'approved' and occurred_at <= $7::timestamptz
      order by occurred_at, id`,
    [
      input.programmeId,
      input.providerAccountId,
      input.currency,
      input.trackingRef.trim().toLowerCase(),
      input.itemRef,
      input.occurredAt,
    ],
  );
  const covering: string[] = [];
  for (const c of candidates) {
    const remainder = await unreversedRemainder(orgId, c.id, c.commission_minor);
    if (remainder >= input.commissionReversalMinor) covering.push(c.id);
  }
  if (covering.length !== 1) {
    const reason = covering.length === 0 ? 'NO_CANDIDATE' : 'AMBIGUOUS';
    await writeOutbox(orgId, 'conversion.return_unmatched', {
      org_id: orgId,
      connector: input.connector,
      provider_account_id: input.providerAccountId,
      return_key: input.returnKey,
      tracking_ref: input.trackingRef,
      item_ref: input.itemRef,
      occurred_at: input.occurredAt,
      commission_reversal_minor: input.commissionReversalMinor,
      reason,
      candidates: covering.length,
    });
    log.info({ returnKey: input.returnKey, reason, candidates: covering.length }, 'return row left unapplied (never guessed)');
    return { kind: 'unmatched', adjustmentId, reason, candidates: covering.length };
  }

  const conversionId = covering[0] as string;
  const written = await insertReversalWithinRemainder(orgId, {
    adjustmentId,
    conversionId,
    commissionMinor: input.commissionReversalMinor,
    reason: input.reason,
  });
  if (written === 'exists') {
    // Applied concurrently under the same deterministic id.
    return { kind: 'deduped', adjustmentId, conversionId };
  }
  if (written === 'exceeds') {
    // Another reversal took the remainder between the candidate read and the
    // write: nothing written, reported like any unmatched return.
    await writeOutbox(orgId, 'conversion.return_unmatched', {
      org_id: orgId,
      connector: input.connector,
      provider_account_id: input.providerAccountId,
      return_key: input.returnKey,
      tracking_ref: input.trackingRef,
      item_ref: input.itemRef,
      occurred_at: input.occurredAt,
      commission_reversal_minor: input.commissionReversalMinor,
      reason: 'NO_CANDIDATE',
      candidates: 0,
    });
    log.info({ returnKey: input.returnKey }, 'return row left unapplied: the remainder was taken concurrently');
    return { kind: 'unmatched', adjustmentId, reason: 'NO_CANDIDATE', candidates: 0 };
  }
  const ledger = await postAdjustmentForReversal(getPool(), { adjustmentId, conversionId });
  await writeOutbox(orgId, 'conversion.reversed', {
    adjustment_id: adjustmentId,
    conversion_id: conversionId,
    org_id: orgId,
    connector: input.connector,
    reversal_commission_minor: input.commissionReversalMinor,
    return_key: input.returnKey,
    ledger,
  });
  return { kind: 'applied', adjustmentId, conversionId, ledger };
}

/**
 * Insert one reversal adjustment only while the conversion's reversals stay
 * within its commission — atomically: in one transaction the conversion row
 * is locked (`for update`, so a concurrent writer that also locks waits),
 * and the insert itself carries the remainder check (under READ COMMITTED
 * the statement after the lock sees every reversal committed before it).
 * 'inserted' | 'exists' (this id is already there: a retry) | 'exceeds'
 * (it would reverse more than remains; nothing written).
 */
export async function insertReversalWithinRemainder(
  orgId: string,
  a: { adjustmentId: string; conversionId: string; commissionMinor: number; reason: string },
): Promise<'inserted' | 'exists' | 'exceeds'> {
  if (!Number.isSafeInteger(a.commissionMinor) || a.commissionMinor <= 0) {
    throw new Error('insertReversalWithinRemainder: commissionMinor must be a positive integer of minor units');
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`select id from conversions where org_id = $1 and id = $2 for update`, [
      orgId,
      a.conversionId,
    ]);
    if (locked.rows.length === 0) throw new Error('insertReversalWithinRemainder: conversion not found in this organisation');
    const ins = await client.query(
      `insert into adjustments (id, org_id, conversion_id, kind, commission_delta_minor, reason)
       select $2::uuid, $1::uuid, $3::uuid, 'reversal', $4::bigint, $5::text
        where (select coalesce(sum(x.commission_delta_minor), 0) from adjustments x
                where x.org_id = $1 and x.conversion_id = $3 and x.kind = 'reversal') + $4::bigint
              <= (select c.commission_minor from conversions c where c.org_id = $1 and c.id = $3)
       on conflict (id) do nothing
       returning id`,
      [orgId, a.adjustmentId, a.conversionId, String(a.commissionMinor), a.reason],
    );
    let outcome: 'inserted' | 'exists' | 'exceeds' = 'inserted';
    if (ins.rows.length === 0) {
      const had = await client.query(`select id from adjustments where org_id = $1 and id = $2`, [orgId, a.adjustmentId]);
      outcome = had.rows.length > 0 ? 'exists' : 'exceeds';
    }
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

export type OperatorReturnOutcome =
  | { kind: 'applied'; adjustmentId: string; conversionId: string; ledger: 'posted' | 'skipped' }
  | { kind: 'deduped'; adjustmentId: string; conversionId: string }
  | { kind: 'refused'; reason: string };

/**
 * An operator's decision for a return the import left unmatched (the CLI's
 * `apply-return`, `amazon.sh returns`): the return's identity and amount come
 * from its `conversion.return_unmatched` event, never typed in; the operator
 * names the ONE sale. That sale must be an approved conversion of the same
 * programme, provider account, currency, tracking ID and item, with an
 * unreversed commission that covers the return. The adjustment id is the
 * import's own (returnAdjustmentId), so a re-run, or a later import of the
 * same return row, is a no-op.
 */
export async function applyReturnToConversion(
  orgId: string,
  input: Omit<ReturnIngestInput, 'occurredAt'> & { conversionId: string; actorId: string | null },
): Promise<OperatorReturnOutcome> {
  const adjustmentId = returnAdjustmentId(input.providerAccountId, input.returnKey);
  const existing = await findReturnAdjustment(orgId, adjustmentId);
  if (existing) {
    if (existing.commission_delta_minor !== input.commissionReversalMinor) {
      return { kind: 'refused', reason: 'this return was already applied with another amount' };
    }
    return { kind: 'deduped', adjustmentId, conversionId: existing.conversion_id };
  }
  const { rows } = await tenantQuery<{
    status: string;
    programme_id: string;
    provider_account_id: string;
    currency: string;
    returned_tracking_ref: string | null;
    item_ref: string | null;
  }>(
    orgId,
    `select status, programme_id, provider_account_id, currency, returned_tracking_ref, item_ref
       from conversions where org_id = $1 and id = $2`,
    [input.conversionId],
  );
  const c = rows[0];
  if (!c) return { kind: 'refused', reason: 'no such conversion in this organisation' };
  const mismatch =
    c.status !== 'approved'
      ? `the sale is '${c.status}', not approved`
      : c.programme_id !== input.programmeId || c.provider_account_id !== input.providerAccountId
        ? 'the sale is not of this Amazon account'
        : c.currency !== input.currency
          ? `the sale is in ${c.currency}, the return in ${input.currency}`
          : (c.returned_tracking_ref ?? '') !== input.trackingRef.trim().toLowerCase()
            ? `the sale's tracking ID is ${c.returned_tracking_ref ?? 'none'}, the return's ${input.trackingRef}`
            : c.item_ref !== input.itemRef
              ? `the sale's item is ${c.item_ref ?? 'none'}, the return's ${input.itemRef}`
              : null;
  if (mismatch) return { kind: 'refused', reason: mismatch };

  const written = await insertReversalWithinRemainder(orgId, {
    adjustmentId,
    conversionId: input.conversionId,
    commissionMinor: input.commissionReversalMinor,
    reason: input.reason,
  });
  if (written === 'exists') return { kind: 'deduped', adjustmentId, conversionId: input.conversionId };
  if (written === 'exceeds') return { kind: 'refused', reason: "the return is larger than the sale's unreversed commission" };
  const ledger = await postAdjustmentForReversal(getPool(), { adjustmentId, conversionId: input.conversionId });
  await tenantQuery(
    orgId,
    `insert into audit_log (org_id, actor_id, action, entity, entity_id) values ($1, $2, 'amazon.return_applied', 'conversion', $3)`,
    [input.actorId, input.conversionId],
  );
  await writeOutbox(orgId, 'conversion.reversed', {
    adjustment_id: adjustmentId,
    conversion_id: input.conversionId,
    org_id: orgId,
    connector: input.connector,
    reversal_commission_minor: input.commissionReversalMinor,
    return_key: input.returnKey,
    applied_by_operator: true,
    ledger,
  });
  return { kind: 'applied', adjustmentId, conversionId: input.conversionId, ledger };
}
