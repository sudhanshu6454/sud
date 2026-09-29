import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError, buildEnvelope } from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { resolveAttribution, type SuspenseReason } from '../conversion-ingest.js';
import { ok, parseOr400 } from './_helpers.js';

/**
 * Suspense queue operations (finance / publisher-operations console).
 *
 * Read model: conversions with click_id IS NULL AND placement_id IS NULL
 * (no click and no tracking-ID placement) and status <> 'declined' (see
 * packages/workers/src/suspense.ts). Everything here is org-scoped.
 *
 * ######################################################################
 * # POLICY (enforced in code, not just comments):                       #
 * #                                                                    #
 * # Unknown attribution stays unknown. Retry binds a click ONLY when    #
 * # the provider-returned click reference EXACTLY matches an existing  #
 * # click row (clicks.click_id = conversions.returned_click_ref), or a  #
 * # placement ONLY when the provider-reported tracking ID EXACTLY       #
 * # matches one mapping that began on or before the sale (the same     #
 * # resolveAttribution the ingest path runs).                          #
 * # There is no fuzzy matching: no LIKE, no timestamp/IP correlation,   #
 * # no "likely publisher" heuristic, no fallback when the reference     #
 * # is absent (422). Review never changes click_id and never posts      #
 * # ledger entries. Anything less than deterministic evidence stays     #
 * # unknown.                                                           #
 * ######################################################################
 */

const OPS_ROLES = ['finance_operator', 'finance_approver', 'network_admin'] as const;

export type SuspenseReasonCode = 'CLICK_REF_UNMATCHED' | 'NO_CLICK_REF' | SuspenseReason;

export interface SuspenseItem {
  id: string;
  programme_id: string;
  programme_name: string;
  provider_account_id: string;
  source_transaction_id: string;
  returned_click_ref: string | null;
  /** The tracking ID the provider reported (Amazon.in Associates), or null. */
  returned_tracking_ref: string | null;
  currency: string;
  eligible_value_minor: number;
  commission_minor: number;
  provider_status: string;
  status: string;
  /** ISO string in production (pg serializes timestamptz); Date under pg-mem. */
  received_at: unknown;
  /** The raw provider event payload (conversions.raw), surfaced for human evidence review. */
  raw: unknown;
  reason_code: SuspenseReasonCode;
  reviewed_at: unknown;
  reviewed_by: string | null;
  review_note: string | null;
}

const SuspenseQuery = z.object({
  connector: z.string().min(1).max(100).optional(),
  programme_id: z.string().uuid().optional(),
  received_from: z.string().datetime({ offset: true }).optional(),
  received_to: z.string().datetime({ offset: true }).optional(),
  reviewed: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const SuspenseParams = z.object({ id: z.string().uuid() });

const ReviewBody = z.object({
  /** Required evidence note: why the row stays unknown / what was checked. */
  note: z.string().min(10, 'Review note must be at least 10 characters').max(2000),
});

interface RawRow {
  id: string;
  programme_id: string;
  programme_name: string;
  provider_account_id: string;
  source_transaction_id: string;
  returned_click_ref: string | null;
  returned_tracking_ref: string | null;
  suspense_reason: SuspenseReason | null;
  currency: string;
  eligible_value_minor: string | number;
  commission_minor: string | number;
  provider_status: string;
  status: string;
  received_at: unknown;
  raw: unknown;
  reviewed_at: unknown;
  reviewed_by: string | null;
  review_note: string | null;
}

/**
 * Derived from data only, never invented:
 * - the reason the ingest path stored (conversions.suspense_reason: an
 *   unmapped tracking ID, the store's default ID, a mapping younger than the
 *   sale, a click whose tag disagrees with the reported tracking ID) wins;
 * - otherwise the suspense predicate already guarantees the row is
 *   unattributed, so a present-but-still-unbound click reference means no
 *   click matched it at read time -> CLICK_REF_UNMATCHED;
 * - a tracking ID and no click reference -> TRACKING_ID_UNMAPPED;
 * - no reference at all means there is nothing deterministic to match
 *   against -> NO_CLICK_REF.
 */
function reasonCode(r: Pick<RawRow, 'returned_click_ref' | 'returned_tracking_ref' | 'suspense_reason'>): SuspenseReasonCode {
  if (r.suspense_reason) return r.suspense_reason;
  if (r.returned_click_ref !== null) return 'CLICK_REF_UNMATCHED';
  if (r.returned_tracking_ref) return 'TRACKING_ID_UNMAPPED';
  return 'NO_CLICK_REF';
}

function toItem(r: RawRow): SuspenseItem {
  return {
    id: r.id,
    programme_id: r.programme_id,
    programme_name: r.programme_name,
    provider_account_id: r.provider_account_id,
    source_transaction_id: r.source_transaction_id,
    returned_click_ref: r.returned_click_ref,
    returned_tracking_ref: r.returned_tracking_ref ?? null,
    currency: r.currency,
    eligible_value_minor: Number(r.eligible_value_minor),
    commission_minor: Number(r.commission_minor),
    provider_status: r.provider_status,
    status: r.status,
    received_at: r.received_at,
    raw: r.raw,
    reason_code: reasonCode(r),
    reviewed_at: r.reviewed_at,
    reviewed_by: r.reviewed_by,
    review_note: r.review_note,
  };
}

const ITEM_COLS = `c.id, c.programme_id, p.name as programme_name,
  c.provider_account_id, c.source_transaction_id, c.returned_click_ref,
  c.returned_tracking_ref, c.suspense_reason,
  c.currency, c.eligible_value_minor, c.commission_minor, c.provider_status,
  c.status, c.received_at, c.raw,
  c.reviewed_at, c.reviewed_by, c.review_note`;

/** Build the shared WHERE clause (without ORDER/LIMIT) for list + count. */
function suspenseFilters(q: z.output<typeof SuspenseQuery>): { clause: string; params: unknown[] } {
  // tenantQuery prepends org_id as $1, so local placeholders start at $2.
  const filters = [`c.org_id = $1`, `c.click_id is null`, `c.placement_id is null`, `c.status <> 'declined'`];
  const params: unknown[] = [];
  if (q.connector) {
    params.push(q.connector);
    filters.push(`p.connector = $${params.length + 1}`);
  }
  if (q.programme_id) {
    params.push(q.programme_id);
    filters.push(`c.programme_id = $${params.length + 1}`);
  }
  if (q.received_from) {
    params.push(q.received_from);
    filters.push(`c.received_at >= $${params.length + 1}::timestamptz`);
  }
  if (q.received_to) {
    params.push(q.received_to);
    filters.push(`c.received_at <= $${params.length + 1}::timestamptz`);
  }
  if (q.reviewed === 'true') {
    filters.push(`c.reviewed_at is not null`);
  } else if (q.reviewed === 'false') {
    filters.push(`c.reviewed_at is null`);
  }
  return { clause: filters.join(' and '), params };
}

async function writeOutboxTx(
  client: PoolClient,
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const envelope = buildEnvelope({ source: 'api', event_type: eventType, payload });
  await client.query(
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [orgId, randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
}

interface SuspenseRow {
  id: string;
  click_id: string | null;
  placement_id: string | null;
  returned_click_ref: string | null;
  returned_tracking_ref: string | null;
  provider_account_id: string;
  programme_id: string;
  /** timestamptz: pg returns string, pg-mem returns Date. */
  occurred_at: string | Date;
  status: string;
}

async function fetchRow(orgId: string, id: string): Promise<SuspenseRow | null> {
  const { rows } = await tenantQuery<SuspenseRow>(
    orgId,
    `select id, click_id, placement_id, returned_click_ref, returned_tracking_ref,
            provider_account_id, programme_id, occurred_at, status
       from conversions where org_id = $1 and id = $2`,
    [id],
  );
  return rows[0] ?? null;
}

export async function suspenseRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/suspense',
    { preHandler: [requireAuth, requireRole(...OPS_ROLES)] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const q = parseOr400(SuspenseQuery, req.query);
      const { clause, params } = suspenseFilters(q);

      const { rows } = await tenantQuery<RawRow>(
        orgId,
        `select ${ITEM_COLS}
           from conversions c
           join programmes p on p.id = c.programme_id and p.org_id = $1
          where ${clause}
          order by c.received_at desc, c.id desc
          limit $${params.length + 2} offset $${params.length + 3}`,
        [...params, q.limit, q.offset],
      );
      const count = await tenantQuery<{ total: string | number }>(
        orgId,
        `select count(*) as total
           from conversions c
           join programmes p on p.id = c.programme_id and p.org_id = $1
          where ${clause}`,
        params,
      );
      return ok(req, {
        items: rows.map(toItem),
        limit: q.limit,
        offset: q.offset,
        total: Number(count.rows[0]?.total ?? 0),
      });
    },
  );

  /**
   * Re-run attribution for one suspense row, RIGHT NOW.
   *
   * Binds click_id only when the provider-returned click reference EXACTLY
   * matches an existing click row (clicks.click_id = returned_click_ref).
   * Exact equality only — never LIKE, never a timestamp/IP correlation, never
   * a "likely publisher" guess. A NULL reference has nothing deterministic
   * to retry against and is a 422 (enforced, not advisory).
   */
  app.post(
    '/v1/suspense/:id/retry',
    { preHandler: [requireAuth, requireRole(...OPS_ROLES), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(SuspenseParams, req.params);

      const row = await fetchRow(orgId, id);
      if (!row || row.status === 'declined') {
        throw new AppError('NOT_FOUND', 'Suspense entry not found for this organisation', 404);
      }
      if (row.click_id || row.placement_id) {
        throw new AppError(
          'CONFLICT',
          row.click_id ? 'Conversion is already attributed to a click' : 'Conversion is already attributed to a placement',
          409,
        );
      }
      if (row.returned_click_ref === null && !row.returned_tracking_ref) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Cannot retry attribution: the conversion carries no provider-returned click reference. ' +
            'Items without a reference stay unknown until human review records deterministic evidence; ' +
            'the platform never guesses a click.',
          422,
        );
      }

      // EXACT matches only, through the same rules as ingest: a click by
      // clicks.click_id (globally unique), or the ONE placement a reported
      // tracking ID is mapped to.
      const attribution = await resolveAttribution(orgId, {
        providerAccountId: row.provider_account_id,
        programmeId: row.programme_id,
        returnedClickRef: row.returned_click_ref,
        trackingRef: row.returned_tracking_ref,
        occurredAt: new Date(row.occurred_at).toISOString(),
      });
      if (!attribution.clickPk && !attribution.placementId) {
        // Still no match: leave the row untouched. No audit, no outbox —
        // nothing changed, and "nothing found" is the expected outcome here.
        const reason: SuspenseReasonCode =
          attribution.suspenseReason ?? (row.returned_click_ref !== null ? 'CLICK_REF_UNMATCHED' : 'TRACKING_ID_UNMAPPED');
        return ok(req, { id, attributed: false, reason });
      }
      const clickId = attribution.clickPk;
      const placementId = attribution.placementId;

      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        // Re-check click_id / placement_id IS NULL inside the transaction so
        // two concurrent retries cannot double-bind.
        const bound = await client.query(
          `update conversions
              set click_id = $3, placement_id = $4, suspense_reason = null
            where org_id = $1 and id = $2 and click_id is null and placement_id is null
              and status <> 'declined'
            returning id`,
          [orgId, id, clickId, placementId],
        );
        if (bound.rows.length === 0) {
          throw new AppError('CONFLICT', 'Suspense entry was attributed concurrently', 409);
        }
        await client.query(
          `insert into audit_log (org_id, actor_id, action, entity, entity_id)
           values ($1, $2, 'suspense.attributed', 'conversion', $3)`,
          [orgId, tenant.sub, id],
        );
        await writeOutboxTx(client, orgId, 'suspense.attributed', {
          conversion_id: id,
          click_id: clickId,
          placement_id: placementId,
          returned_click_ref: row.returned_click_ref,
          returned_tracking_ref: row.returned_tracking_ref,
          org_id: orgId,
          attributed_by: tenant.sub,
        });
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Rollback best-effort; the original error is what matters.
        }
        throw err;
      } finally {
        client.release();
      }

      return ok(
        req,
        clickId
          ? { id, attributed: true as const, click_id: clickId }
          : { id, attributed: true as const, placement_id: placementId },
      );
    },
  );

  /**
   * Mark a suspense row reviewed. Writes the review note, actor, and
   * timestamp, plus an audit_log entry.
   *
   * NEVER changes click_id (attribution) and NEVER posts ledger entries —
   * review is bookkeeping about the human's decision, not a write to the
   * money trail. The update touches reviewed_* columns only, by construction.
   */
  app.post(
    '/v1/suspense/:id/review',
    { preHandler: [requireAuth, requireRole(...OPS_ROLES), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(SuspenseParams, req.params);
      const body = parseOr400(ReviewBody, req.body);

      const row = await fetchRow(orgId, id);
      if (!row || row.status === 'declined') {
        throw new AppError('NOT_FOUND', 'Suspense entry not found for this organisation', 404);
      }
      if (row.click_id || row.placement_id) {
        throw new AppError('CONFLICT', 'Conversion is already attributed; the review queue only tracks unattributed conversions', 409);
      }

      const { rows } = await tenantQuery<RawRow>(
        orgId,
        `update conversions
            set reviewed_at = now(), reviewed_by = $3, review_note = $4
          where org_id = $1 and id = $2 and click_id is null and placement_id is null
            and status <> 'declined'
          returning id, reviewed_at, reviewed_by, review_note`,
        [id, tenant.sub, body.note],
      );
      const updated = rows[0];
      if (!updated) {
        throw new AppError('CONFLICT', 'Suspense entry was attributed concurrently', 409);
      }

      await tenantQuery(
        orgId,
        `insert into audit_log (org_id, actor_id, action, entity, entity_id)
         values ($1, $2, 'suspense.reviewed', 'conversion', $3)`,
        [tenant.sub, id],
      );

      return ok(req, {
        id: updated.id,
        reviewed_at: updated.reviewed_at,
        reviewed_by: updated.reviewed_by,
        review_note: updated.review_note,
      });
    },
  );
}
