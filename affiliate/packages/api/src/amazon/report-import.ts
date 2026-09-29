/**
 * Amazon.in Associates earnings-report import — an adapter over the one money
 * path (src/conversion-ingest.ts), used by the API route
 * (routes/amazon-reports.ts) and the CLI (src/cli/amazon.ts import-report).
 *
 *   shipped row → ingestConversionEvent: provider_account_id = the account's
 *                 account_ref, source_transaction_id = 'amzn-earn:<date>:<ASIN>:<hash>',
 *                 line_id 'shipped', approved at revision 0, eligible = Revenue,
 *                 commission = Ad Fees (Amazon's figure, never recomputed),
 *                 trackingRef = the row's tracking ID, itemRef = the ASIN;
 *                 attribution by the tracking-ID mapping, else suspense (no
 *                 click ref: no click id is ever put on an Amazon URL, so a
 *                 report's sub-tag column is kept as evidence only).
 *   return row  → ingestReturnEvent: a reversal of |Ad Fees| on the ONE
 *                 matching approved conversion, deterministic adjustment id;
 *                 unmatched returns are reported, never guessed.
 *   zero row    → skipped (nothing to record).
 *
 * All-or-nothing validation (parseEarningsReport), then a conflict pre-pass:
 * a row whose key already exists with DIFFERENT amounts refuses the whole
 * file (409) before anything is written — the machine never rewrites an
 * amount. A re-import of the same file is a no-op (every row dedupes).
 *
 * One import at a time per account: the whole import (pre-pass and writes)
 * runs under a session-level advisory lock keyed by the organisation and
 * the account_ref, taken on a dedicated pool connection with
 * pg_try_advisory_lock and retried (the connection handed back between
 * tries, so waiting imports hold none) for up to IMPORT_LOCK_WAIT_MS; then
 * 409, nothing written. Without it two concurrent imports each passed the
 * pre-pass and each reversed the same sale's full remainder (a real-Postgres
 * race, 2026-09-29). Both the API route and the CLI come through here.
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, tenantQuery } from '../db.js';
import {
  findReturnAdjustment,
  ingestConversionEvent,
  ingestReturnEvent,
  returnAdjustmentId,
  type IngestLog,
  type IngestOutcome,
  type ReturnOutcome,
} from '../conversion-ingest.js';
import { toMinorUnits } from '../finance.js';
import type { AmazonAccount } from './account.js';
import {
  earningsRowIdentity,
  parseEarningsReport,
  reportDateToOccurredAt,
  type EarningsRow,
  type RowError,
} from './report-format.js';
import { AMAZON_CONNECTOR } from '@paparazzi/shared';

/** Same cap as the CSV connector's inline uploads. */
export const MAX_REPORT_BYTES = 2_000_000;

/** How long an import waits for another import of the same account before refusing (409). */
export const IMPORT_LOCK_WAIT_MS = 30_000;
const IMPORT_LOCK_RETRY_MS = 250;

/**
 * The account's import lock (see the file docstring), or null when another
 * import still holds it after `waitMs`. The caller releases it with
 * releaseImportLock. The key names the organisation, so two tenants never
 * share one.
 */
export async function acquireImportLock(orgId: string, accountRef: string, waitMs = IMPORT_LOCK_WAIT_MS): Promise<PoolClient | null> {
  const key = `amazon-report-import:${orgId}:${accountRef}`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const client = await getPool().connect();
    let locked = false;
    try {
      const { rows } = await client.query<{ locked: boolean }>(`select pg_try_advisory_lock(hashtext($1)) as locked`, [key]);
      locked = rows[0]?.locked === true;
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
    if (locked) return client;
    client.release();
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, IMPORT_LOCK_RETRY_MS));
  }
}

export async function releaseImportLock(client: PoolClient, orgId: string, accountRef: string): Promise<void> {
  try {
    await client.query(`select pg_advisory_unlock(hashtext($1))`, [`amazon-report-import:${orgId}:${accountRef}`]);
    client.release();
  } catch (err) {
    // Destroy the connection: closing the session drops its advisory locks.
    client.release(err as Error);
  }
}

export interface RowResult {
  row: number;
  kind: EarningsRow['kind'];
  outcome: IngestOutcome['kind'] | ReturnOutcome['kind'] | 'skipped';
  conversion_id?: string;
  adjustment_id?: string;
  status?: string;
  attributed_by?: 'click' | 'tracking_id' | null;
  ledger?: 'posted' | 'skipped';
  reason?: string;
}

export interface ImportSummary {
  account_id: string;
  account_ref: string;
  programme_id: string;
  layout: { delimiter: 'tab' | 'comma'; header_row: number; columns: Record<string, string> };
  rows_received: number;
  shipped: { created: number; deduped: number; attributed_click: number; attributed_tracking_id: number; suspense: number };
  returns: { applied: number; deduped: number; unmatched: number };
  skipped_zero: number;
  results: RowResult[];
  unmatched_returns: Array<{ row: number; tracking_id: string; asin: string; date: string; fee_minor: number; reason: string }>;
}

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; status: 400 | 409 | 422; code: 'VALIDATION_ERROR' | 'CONFLICT'; message: string; errors: RowError[] };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function shippedSourceTransactionId(r: EarningsRow): string {
  return `amzn-earn:${r.date}:${r.asin}:${sha256(earningsRowIdentity(r)).slice(0, 32)}`;
}

export function returnKey(r: EarningsRow): string {
  return `amzn-return:${r.date}:${r.asin}:${sha256(earningsRowIdentity(r))}`;
}

export async function importAmazonEarningsReport(opts: {
  orgId: string;
  account: AmazonAccount;
  text: string;
  receivedVia: 'api' | 'cli';
  log: IngestLog;
  /** Test seam: how long to wait for another import of the account (default IMPORT_LOCK_WAIT_MS). */
  lockWaitMs?: number;
}): Promise<ImportResult> {
  const { orgId, account } = opts;
  const lock = await acquireImportLock(orgId, account.account_ref, opts.lockWaitMs);
  if (!lock) {
    return {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      message: "Another import of this account's reports is still running; nothing was written. Run this one again when it has finished",
      errors: [],
    };
  }
  try {
    return await importLocked(opts);
  } finally {
    await releaseImportLock(lock, orgId, account.account_ref);
  }
}

async function importLocked(opts: {
  orgId: string;
  account: AmazonAccount;
  text: string;
  receivedVia: 'api' | 'cli';
  log: IngestLog;
}): Promise<ImportResult> {
  const { orgId, account, text, log } = opts;
  if (Buffer.byteLength(text, 'utf8') > MAX_REPORT_BYTES) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: `report exceeds the ${MAX_REPORT_BYTES}-byte limit; split the date range into smaller downloads`,
      errors: [],
    };
  }
  if (account.status !== 'active') {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'The Amazon Associates account is disabled', errors: [] };
  }
  const prog = await tenantQuery<{ status: string }>(
    orgId,
    `select status from programmes where org_id = $1 and id = $2`,
    [account.programme_id],
  );
  const programmeStatus = prog.rows[0]?.status;
  // A paused programme still earns on sessions its links started; draft/blocked never do.
  if (programmeStatus !== 'active' && programmeStatus !== 'paused') {
    return {
      ok: false,
      status: 422,
      code: 'VALIDATION_ERROR',
      message: `The account's programme is '${programmeStatus ?? 'missing'}'; reports import into an active or paused programme only`,
      errors: [],
    };
  }

  const parsed = parseEarningsReport(text, account.currency);
  if (!parsed.ok) return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: parsed.message, errors: parsed.errors };
  const report = parsed.report;

  // Duplicate identities inside one file: two rows the report itself does not tell apart.
  const seen = new Map<string, number>();
  const dupErrors: RowError[] = [];
  for (const r of report.rows) {
    if (r.kind === 'zero') continue;
    const id = earningsRowIdentity(r);
    const first = seen.get(id);
    if (first !== undefined) {
      dupErrors.push({ row: r.row, reason: `same tracking ID, ASIN, date, seller, device, link type and price as row ${first}` });
    } else seen.set(id, r.row);
  }
  if (dupErrors.length > 0) {
    return {
      ok: false,
      status: 422,
      code: 'VALIDATION_ERROR',
      message: `${dupErrors.length} row(s) repeat another row's identity; nothing was imported (layout to confirm with a real export)`,
      errors: dupErrors,
    };
  }

  // Conflict pre-pass: an existing key with different amounts refuses the file before any write.
  const conflicts: RowError[] = [];
  for (const r of report.rows) {
    if (r.kind === 'shipped') {
      const { rows } = await tenantQuery<{ eligible_value_minor: string; commission_minor: string; currency: string }>(
        orgId,
        `select eligible_value_minor::text as eligible_value_minor, commission_minor::text as commission_minor, currency
           from conversions
          where org_id = $1 and provider_account_id = $2 and source_transaction_id = $3 and line_id = 'shipped'`,
        [account.account_ref, shippedSourceTransactionId(r)],
      );
      const c = rows[0];
      if (
        c &&
        (toMinorUnits(c.eligible_value_minor) !== r.revenueMinor ||
          toMinorUnits(c.commission_minor) !== r.adFeesMinor ||
          c.currency !== report.currency)
      ) {
        conflicts.push({
          row: r.row,
          reason: `already imported with revenue ${c.eligible_value_minor} / fees ${c.commission_minor} paise; this file says ${r.revenueMinor} / ${r.adFeesMinor}`,
        });
      }
    } else if (r.kind === 'return' && r.adFeesMinor < 0) {
      const existing = await findReturnAdjustment(orgId, returnAdjustmentId(account.account_ref, returnKey(r)));
      if (existing && existing.commission_delta_minor !== -r.adFeesMinor) {
        conflicts.push({
          row: r.row,
          reason: `return already applied for ${existing.commission_delta_minor} paise; this file says ${-r.adFeesMinor}`,
        });
      }
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      message: `${conflicts.length} row(s) were imported before with different amounts; amounts are never rewritten, nothing was imported`,
      errors: conflicts,
    };
  }

  const summary: ImportSummary = {
    account_id: account.id,
    account_ref: account.account_ref,
    programme_id: account.programme_id,
    layout: { delimiter: report.delimiter, header_row: report.headerRow, columns: report.columns as Record<string, string> },
    rows_received: report.rows.length,
    shipped: { created: 0, deduped: 0, attributed_click: 0, attributed_tracking_id: 0, suspense: 0 },
    returns: { applied: 0, deduped: 0, unmatched: 0 },
    skipped_zero: 0,
    results: [],
    unmatched_returns: [],
  };

  // Sales first, so a sale and its return in the same file can meet.
  for (const r of report.rows.filter((x) => x.kind === 'shipped')) {
    const outcome = await ingestConversionEvent(
      orgId,
      {
        connector: AMAZON_CONNECTOR,
        receivedVia: opts.receivedVia === 'api' ? 'report_upload' : 'report_cli',
        programmeId: account.programme_id,
        providerAccountId: account.account_ref,
        sourceTransactionId: shippedSourceTransactionId(r),
        lineId: 'shipped',
        returnedClickRef: null,
        trackingRef: r.trackingId,
        itemRef: r.asin,
        currency: report.currency,
        eligibleValueMinor: r.revenueMinor,
        commissionMinor: r.adFeesMinor,
        providerStatus: 'approved',
        providerRevision: 0,
        occurredAt: reportDateToOccurredAt(r.date),
        rawExtra: {
          report: 'earnings',
          report_row: {
            tracking_id: r.trackingId,
            asin: r.asin,
            date: r.date,
            seller: r.seller,
            device_type_group: r.deviceTypeGroup,
            link_type: r.linkType,
            price_minor: r.priceMinor,
            items_shipped: r.itemsShipped,
            subtag: r.subtag,
          },
        },
      },
      log,
    );
    let attributedBy: RowResult['attributed_by'] = null;
    if (outcome.kind === 'created') {
      summary.shipped.created += 1;
      const { rows } = await tenantQuery<{ click_id: string | null; placement_id: string | null }>(
        orgId,
        `select click_id, placement_id from conversions where org_id = $1 and id = $2`,
        [outcome.conversionId],
      );
      const c = rows[0];
      attributedBy = c?.click_id ? 'click' : c?.placement_id ? 'tracking_id' : null;
      if (attributedBy === 'click') summary.shipped.attributed_click += 1;
      else if (attributedBy === 'tracking_id') summary.shipped.attributed_tracking_id += 1;
      else summary.shipped.suspense += 1;
    } else summary.shipped.deduped += 1;
    summary.results.push({
      row: r.row,
      kind: r.kind,
      outcome: outcome.kind,
      conversion_id: outcome.conversionId,
      status: outcome.status,
      attributed_by: outcome.kind === 'created' ? attributedBy : undefined,
      ledger: 'ledger' in outcome ? outcome.ledger : undefined,
    });
  }

  for (const r of report.rows.filter((x) => x.kind !== 'shipped')) {
    if (r.kind === 'zero' || r.adFeesMinor === 0) {
      // A zero row, or a return that carried no fee (a 0% category): nothing to record.
      summary.skipped_zero += 1;
      summary.results.push({ row: r.row, kind: r.kind, outcome: 'skipped', reason: 'no fee to record' });
      continue;
    }
    const outcome = await ingestReturnEvent(
      orgId,
      {
        connector: AMAZON_CONNECTOR,
        programmeId: account.programme_id,
        providerAccountId: account.account_ref,
        returnKey: returnKey(r),
        currency: report.currency,
        trackingRef: r.trackingId,
        itemRef: r.asin,
        occurredAt: reportDateToOccurredAt(r.date),
        commissionReversalMinor: -r.adFeesMinor,
        reason: `Amazon earnings report return of ${r.date} (${r.returns} item(s))`,
      },
      log,
    );
    if (outcome.kind === 'applied') summary.returns.applied += 1;
    else if (outcome.kind === 'deduped') summary.returns.deduped += 1;
    else {
      summary.returns.unmatched += 1;
      summary.unmatched_returns.push({
        row: r.row,
        tracking_id: r.trackingId,
        asin: r.asin,
        date: r.date,
        fee_minor: r.adFeesMinor,
        reason: outcome.reason,
      });
    }
    summary.results.push({
      row: r.row,
      kind: r.kind,
      outcome: outcome.kind,
      adjustment_id: outcome.adjustmentId,
      conversion_id: 'conversionId' in outcome ? outcome.conversionId : undefined,
      ledger: outcome.kind === 'applied' ? outcome.ledger : undefined,
      reason: outcome.kind === 'unmatched' ? outcome.reason : undefined,
    });
  }
  summary.results.sort((a, b) => a.row - b.row);
  return { ok: true, summary };
}
