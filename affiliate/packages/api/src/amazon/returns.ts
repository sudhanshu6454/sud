/**
 * Amazon.in Associates — the returns the report import left unmatched
 * (src/cli/amazon.ts `returns` and `apply-return`; deploy/linode/amazon.sh
 * `returns`).
 *
 * The import reverses a return row only when exactly ONE approved sale of the
 * same account, tracking ID and ASIN, dated on or before the return, covers
 * its fee (conversion-ingest.ts ingestReturnEvent). Otherwise nothing is
 * applied and a `conversion.return_unmatched` outbox event records the
 * return: its key, tracking ID, ASIN, date and fee. Never guessed.
 *
 * returns       lists every such return not applied since (latest event per
 *               return key), with the sales it could belong to: approved
 *               conversions of the account with the same tracking ID, ASIN and
 *               currency whose unreversed commission covers the fee, each
 *               marked whether it is dated on or before the return.
 * apply-return  the operator's decision: the return (by its key; its amount
 *               and identity come from the event, never typed in) applied to
 *               the ONE sale named (applyReturnToConversion: same account,
 *               tracking ID, ASIN and currency, approved, covering), under
 *               the import's own deterministic adjustment id, so a re-run —
 *               or the same return row in a later import — does nothing.
 *
 * Every query names the org_id ($1).
 */
import { tenantQuery } from '../db.js';
import { applyReturnToConversion, returnAdjustmentId, type OperatorReturnOutcome } from '../conversion-ingest.js';
import { toMinorUnits } from '../finance.js';
import { AMAZON_CONNECTOR } from '@paparazzi/shared';
import type { AmazonAccount } from './account.js';

export interface UnmatchedReturnCandidate {
  conversion_id: string;
  /** The report's date of the sale (India calendar day). */
  date: string;
  occurred_at: string;
  commission_minor: number;
  remainder_minor: number;
  attributed_by: 'tracking_id' | 'click' | null;
  dated_on_or_before_return: boolean;
}

export interface UnmatchedReturn {
  return_key: string;
  tracking_id: string;
  asin: string;
  /** The report's date of the return row (India calendar day). */
  date: string;
  occurred_at: string;
  fee_minor: number;
  currency: string;
  reason: string;
  reported_at: string;
  candidates: UnmatchedReturnCandidate[];
}

interface ReturnEventPayload {
  provider_account_id: string;
  return_key: string;
  tracking_ref: string;
  item_ref: string;
  occurred_at: string;
  commission_reversal_minor: number;
  reason: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** The India calendar day of an instant (the report's dates are IST days: report-format.ts). */
const istDay = (v: string): string => new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** The latest unmatched-return event per return key of this account (the import re-reports a return on every re-import). */
async function unmatchedEvents(orgId: string, account: AmazonAccount): Promise<Map<string, { p: ReturnEventPayload; at: string }>> {
  const { rows } = await tenantQuery<{ payload: unknown; occurred_at: unknown }>(
    orgId,
    `select payload, occurred_at from outbox
      where org_id = $1 and event_type = 'conversion.return_unmatched'
      order by occurred_at, id`,
  );
  const latest = new Map<string, { p: ReturnEventPayload; at: string }>();
  for (const r of rows) {
    const env = (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as { payload?: ReturnEventPayload };
    const p = env?.payload;
    if (!p || p.provider_account_id !== account.account_ref || typeof p.return_key !== 'string') continue;
    latest.set(p.return_key, { p, at: iso(r.occurred_at) });
  }
  return latest;
}

export async function listUnmatchedReturns(orgId: string, account: AmazonAccount): Promise<UnmatchedReturn[]> {
  const out: UnmatchedReturn[] = [];
  for (const [key, { p, at }] of await unmatchedEvents(orgId, account)) {
    const applied = await tenantQuery<{ id: string }>(orgId, `select id from adjustments where org_id = $1 and id = $2`, [
      returnAdjustmentId(account.account_ref, key),
    ]);
    if (applied.rows.length > 0) continue;
    const { rows } = await tenantQuery<{
      id: string;
      occurred_at: unknown;
      commission_minor: string;
      click_id: string | null;
      placement_id: string | null;
    }>(
      orgId,
      `select id, occurred_at, commission_minor::text as commission_minor, click_id, placement_id
         from conversions
        where org_id = $1 and programme_id = $2 and provider_account_id = $3 and currency = $4
          and returned_tracking_ref = $5 and item_ref = $6 and status = 'approved'
        order by occurred_at, id`,
      [account.programme_id, account.account_ref, account.currency, String(p.tracking_ref).trim().toLowerCase(), p.item_ref],
    );
    const candidates: UnmatchedReturnCandidate[] = [];
    for (const c of rows) {
      const rev = await tenantQuery<{ reversed: string | null }>(
        orgId,
        `select sum(commission_delta_minor)::text as reversed from adjustments
          where org_id = $1 and conversion_id = $2 and kind = 'reversal'`,
        [c.id],
      );
      const commission = toMinorUnits(c.commission_minor);
      const remainder = Math.max(commission - Number(rev.rows[0]?.reversed ?? 0), 0);
      if (remainder < p.commission_reversal_minor) continue;
      candidates.push({
        conversion_id: c.id,
        date: istDay(iso(c.occurred_at)),
        occurred_at: iso(c.occurred_at),
        commission_minor: commission,
        remainder_minor: remainder,
        attributed_by: c.placement_id ? 'tracking_id' : c.click_id ? 'click' : null,
        dated_on_or_before_return: new Date(iso(c.occurred_at)).getTime() <= new Date(p.occurred_at).getTime(),
      });
    }
    out.push({
      return_key: key,
      tracking_id: p.tracking_ref,
      asin: p.item_ref,
      date: istDay(p.occurred_at),
      occurred_at: p.occurred_at,
      fee_minor: p.commission_reversal_minor,
      currency: account.currency,
      reason: p.reason,
      reported_at: at,
      candidates,
    });
  }
  return out.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.return_key.localeCompare(b.return_key));
}

/** Apply one unmatched return (by its key) to the one sale the operator chose. */
export async function applyUnmatchedReturn(
  orgId: string,
  account: AmazonAccount,
  opts: { returnKey: string; conversionId: string; actorId: string | null },
): Promise<OperatorReturnOutcome> {
  const event = (await unmatchedEvents(orgId, account)).get(opts.returnKey);
  if (!event) return { kind: 'refused', reason: 'no unmatched return with this key for this account (list them with `returns`)' };
  const p = event.p;
  return applyReturnToConversion(orgId, {
    connector: AMAZON_CONNECTOR,
    programmeId: account.programme_id,
    providerAccountId: account.account_ref,
    returnKey: opts.returnKey,
    currency: account.currency,
    trackingRef: p.tracking_ref,
    itemRef: p.item_ref,
    commissionReversalMinor: p.commission_reversal_minor,
    reason: `Amazon earnings report return of ${istDay(p.occurred_at)}, applied by the operator (was ${p.reason})`,
    conversionId: opts.conversionId,
    actorId: opts.actorId,
  });
}
