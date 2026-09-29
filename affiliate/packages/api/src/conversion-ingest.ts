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
 * The worker-side mirror (`packages/workers/src/workers/provider-events.ts`)
 * intentionally keeps its own copy — it runs off the Redis queue, not the
 * API. Do NOT change it from here.
 */
import type { FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { buildEnvelope } from '@paparazzi/shared';
import { getPool, tenantQuery } from './db.js';
import { postAdjustmentForReversal, postLedgerForConversion, toMinorUnits } from './finance.js';

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
function deterministicUuid(seed: string): string {
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
            contract_version_id, click_id, programme_id
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

  // 1) Attribution lookup — click_id or NULL (suspense). Never guessed.
  let clickPk: string | null = null;
  if (returnedClickRef) {
    const hit = await tenantQuery<{ id: string }>(
      orgId,
      `select id from clicks where org_id = $1 and click_id = $2`,
      [returnedClickRef],
    );
    clickPk = hit.rows[0]?.id ?? null;
  }

  // 2) Programme: explicit for CSV uploads, resolved for webhook events.
  const programmeId = input.programmeId ?? (await resolveWebhookProgramme(orgId, connector, clickPk));
  if (!programmeId) {
    throw new Error('CONVERSION_PROGRAMME_UNKNOWN');
  }

  // 3) Insert the conversion (dedupe on provider natural key).
  const conversionId = randomUUID();
  const inserted = await tenantQuery<{ id: string }>(
    orgId,
    `insert into conversions
       (id, org_id, programme_id, provider_account_id, source_transaction_id,
        line_id, returned_click_ref, click_id, currency, eligible_value_minor,
        commission_minor, provider_status, provider_revision, status,
        occurred_at, received_at, raw)
     values
       ($2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), $16::jsonb)
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
      JSON.stringify({ connector, received_via: receivedVia }),
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
        currency,
        commission_minor: String(commissionMinor),
      });
      if (ledger === 'skipped') {
        log.info(
          { conversionId, clickPk },
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
