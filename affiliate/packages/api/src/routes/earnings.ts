import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { authed, requireAuth } from '../middleware.js';
import { computeCollectedAllocation } from '../finance.js';
import { ok, parseOr400 } from './_helpers.js';

const EarningsQuery = z.object({
  publisher_id: z.string().uuid(),
});

interface Balance {
  pending: number;
  approved: number;
  collected: number;
  payable: number;
}

/**
 * GET /v1/publisher/earnings — per-currency publisher balances.
 *
 * The four lifecycle states are kept visually separate (per the brief):
 * - pending:   publisher share of conversions still awaiting provider
 *              approval (status='pending'), attributed via the click chain.
 * - approved:  net `publisher_liability` balance from posted ledger entries.
 * - collected: merchant cash actually received for the publisher's
 *              eligible earnings, allocated pro-rata per (programme, currency)
 *              from merchant_settlements — the same allocation prepare() uses
 *              to cap payouts (see API ASSUMPTIONS.md). Never exceeds what
 *              the merchant has remitted.
 * - payable:   amounts already allocated to payout batches that have not
 *              failed/cancelled.
 *
 * Suspense (unattributed) conversions are excluded everywhere: unknown
 * attribution stays unknown, so they earn nothing for any publisher.
 */
export async function earningsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/publisher/earnings', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const orgId = tenant.org_id;
    const { publisher_id: publisherId } = parseOr400(EarningsQuery, req.query);

    const publisher = await tenantQuery<{ id: string }>(
      orgId,
      `select id from publishers where org_id = $1 and id = $2`,
      [publisherId],
    );
    if (!publisher.rows[0]) {
      throw new AppError('NOT_FOUND', 'Publisher not found for this organisation', 404);
    }

    const balances: Record<string, Balance> = {};
    const bucket = (currency: string): Balance =>
      (balances[currency] ??= { pending: 0, approved: 0, collected: 0, payable: 0 });

    // pending: attributable pending conversions × latest approved contract share.
    // Falls back to 100% of commission when no approved contract exists yet.
    // (Two portable queries + JS math: pg-mem cannot do LATERAL or correlated
    // subqueries, and the per-row integer division matches SQL semantics.)
    const pendingConvs = await tenantQuery<{
      currency: string;
      commission_minor: string;
      publisher_id: string;
      programme_id: string;
    }>(
      orgId,
      `select c.currency as currency, c.commission_minor::text as commission_minor,
              ca.publisher_id as publisher_id, o.programme_id as programme_id
         from conversions c
         join clicks cl      on cl.id = c.click_id        and cl.org_id = $1
         join links l        on l.id = cl.link_id         and l.org_id = $1
         join placements pl  on pl.id = l.placement_id    and pl.org_id = $1
         join campaigns ca   on ca.id = pl.campaign_id    and ca.org_id = $1
         join offers o       on o.id = l.offer_id         and o.org_id = $1
        where c.org_id = $1 and ca.publisher_id = $2 and c.status = 'pending'`,
      [publisherId],
    );
    const latestContracts = await tenantQuery<{
      publisher_id: string;
      programme_id: string;
      publisher_share_bps: number;
      version: number;
    }>(
      orgId,
      `select publisher_id, programme_id, publisher_share_bps, version
         from contracts
        where org_id = $1 and publisher_id = $2 and status = 'approved'
        order by version desc`,
      [publisherId],
    );
    const bpsByProgramme = new Map<string, number>();
    for (const ct of latestContracts.rows) {
      if (!bpsByProgramme.has(ct.programme_id)) bpsByProgramme.set(ct.programme_id, ct.publisher_share_bps);
    }
    for (const pc of pendingConvs.rows) {
      const bps = bpsByProgramme.get(pc.programme_id) ?? 10000;
      bucket(pc.currency).pending += Math.floor((Number(pc.commission_minor) * bps) / 10000);
    }

    // approved: net publisher_liability from the ledger (credits − debits).
    const approved = await tenantQuery<{ currency: string; balance_minor: string }>(
      orgId,
      `select currency, sum(credit_minor - debit_minor)::text as balance_minor
         from ledger_entries
        where org_id = $1 and publisher_id = $2 and account = 'publisher_liability'
        group by currency`,
      [publisherId],
    );
    for (const row of approved.rows) bucket(row.currency).approved = Number(row.balance_minor);

    // collected: pro-rata share of merchant_settlements pools for this
    // publisher's eligible (mature, approved, unreversed) earnings — the
    // same allocation prepare() caps payouts by.
    const collected = await computeCollectedAllocation(getPool(), orgId);
    for (const [key, minor] of collected) {
      const [pubId, currency] = key.split('|');
      if (pubId === publisherId && currency) bucket(currency).collected += minor;
    }

    // payable: amounts already sitting in live payout batches.
    const payable = await tenantQuery<{ currency: string; payable_minor: string }>(
      orgId,
      `select pi.currency as currency, sum(pi.amount_minor)::text as payable_minor
         from payout_items pi
         join payout_batches pb on pb.id = pi.payout_batch_id
        where pb.org_id = $1 and pi.publisher_id = $2
          and pb.status not in ('failed', 'cancelled')
        group by pi.currency`,
      [publisherId],
    );
    for (const row of payable.rows) bucket(row.currency).payable = Number(row.payable_minor);

    return ok(req, { publisher_id: publisherId, balances });
  });
}
