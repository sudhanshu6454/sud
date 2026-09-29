import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError, AppError } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import {
  ingestConversionEvent,
  type ConversionIngestInput,
  type IngestLog,
  type IngestOutcome,
} from '../conversion-ingest.js';
import { ok, parseOr400 } from './_helpers.js';

const CsvUploadBody = z.object({
  provider_account_id: z.string().min(1).max(200),
  /** The uploader names the programme (contrast the webhook path, which resolves it). */
  programme_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  /**
   * The CSV payload as a plain string. Deliberate sandbox choice: avoids
   * multipart parsing and keeps uploads greppable/testable. Real merchants
   * will want multipart or object-storage references — that is a later
   * hardening item, not a correctness gap in the ingestion path.
   */
  csv_text: z.string().min(1),
});

/** Hard cap so a runaway upload cannot OOM the API before parsing. */
const MAX_CSV_BYTES = 2_000_000;

const REQUIRED_COLUMNS = [
  'source_transaction_id',
  'currency',
  'eligible_value_minor',
  'commission_minor',
  'provider_status',
  'occurred_at',
] as const;

const OPTIONAL_COLUMNS = ['line_id', 'returned_click_ref', 'provider_revision'] as const;

const PROVIDER_STATUSES = ['approved', 'pending', 'declined', 'reversed'] as const;

interface RowError {
  row: number;
  reason: string;
}

interface ParsedRow {
  row: number;
  sourceTransactionId: string;
  lineId: string | null;
  returnedClickRef: string | null;
  currency: string;
  eligibleValueMinor: number;
  commissionMinor: number;
  providerStatus: string;
  providerRevision: number;
  occurredAt: string;
}

/**
 * Minimal RFC-4180 CSV parser (no dependencies):
 * - fields separated by `,`; a field wrapped in `"` may contain commas,
 *   newlines, and `""` (escaped quote);
 * - LF and CRLF both terminate records;
 * - a leading UTF-8 BOM is stripped.
 *
 * Throws on an unterminated quoted field.
 */
function parseCsv(text: string): string[][] {
  const s = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (inQuotes) throw new Error('unterminated quoted field');
  // Trailing content after the last newline (a file not ending in \n still
  // holds a record); a file that ends WITH \n leaves nothing behind.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A record where every cell is blank/whitespace carries no data. */
function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === '');
}

function integerMinorUnits(raw: string): number | null {
  const v = raw.trim();
  if (!/^-?\d+$/.test(v)) return null;
  return Number(v);
}

interface ColumnIndex {
  [name: string]: number | undefined;
}

/** Validate one data row; returns the parsed row or the per-row error(s). */
function validateRow(rowNum: number, cells: string[], cols: ColumnIndex): ParsedRow | RowError {
  const cell = (name: string): string => {
    const idx = cols[name];
    return idx === undefined ? '' : (cells[idx] ?? '').trim();
  };
  const reasons: string[] = [];

  const sourceTransactionId = cell('source_transaction_id');
  if (sourceTransactionId === '') reasons.push('source_transaction_id is required');
  if (sourceTransactionId.length > 200) reasons.push('source_transaction_id exceeds 200 characters');

  const lineId = cell('line_id');
  const lineIdNorm = lineId === '' ? null : lineId;
  if (lineIdNorm !== null && lineIdNorm.length > 200) reasons.push('line_id exceeds 200 characters');

  const returnedClickRef = cell('returned_click_ref');
  const returnedClickRefNorm = returnedClickRef === '' ? null : returnedClickRef;
  if (returnedClickRefNorm !== null && returnedClickRefNorm.length > 200) {
    reasons.push('returned_click_ref exceeds 200 characters');
  }

  const currencyRaw = cell('currency');
  let currency = '';
  if (!/^[A-Za-z]{3}$/.test(currencyRaw)) {
    reasons.push(`currency must be a 3-letter code (e.g. INR); got '${currencyRaw}'`);
  } else {
    currency = currencyRaw.toUpperCase();
  }

  const eligibleRaw = cell('eligible_value_minor');
  const eligibleValueMinor = eligibleRaw === '' ? null : integerMinorUnits(eligibleRaw);
  if (eligibleValueMinor === null) {
    reasons.push(
      `eligible_value_minor must be an integer in minor units (no decimals); got '${eligibleRaw}'`,
    );
  } else if (eligibleValueMinor < 0) {
    reasons.push(`eligible_value_minor must be >= 0; got '${eligibleRaw}'`);
  }

  const commissionRaw = cell('commission_minor');
  const commissionMinor = commissionRaw === '' ? null : integerMinorUnits(commissionRaw);
  if (commissionMinor === null) {
    reasons.push(
      `commission_minor must be an integer in minor units (no decimals); got '${commissionRaw}'`,
    );
  } else if (commissionMinor < 0) {
    reasons.push(`commission_minor must be >= 0; got '${commissionRaw}'`);
  }

  const statusRaw = cell('provider_status');
  let providerStatus = '';
  if (!(PROVIDER_STATUSES as readonly string[]).includes(statusRaw.trim().toLowerCase())) {
    reasons.push(
      `provider_status must be one of ${PROVIDER_STATUSES.join('|')}; got '${statusRaw}'`,
    );
  } else {
    providerStatus = statusRaw.trim().toLowerCase();
  }

  const revisionRaw = cell('provider_revision');
  let providerRevision = 0;
  if (revisionRaw !== '') {
    if (!/^\d+$/.test(revisionRaw)) {
      reasons.push(`provider_revision must be an integer >= 0; got '${revisionRaw}'`);
    } else {
      providerRevision = Number(revisionRaw);
    }
  }

  const occurredRaw = cell('occurred_at');
  let occurredAt = '';
  const parsed = occurredRaw === '' ? NaN : Date.parse(occurredRaw);
  if (Number.isNaN(parsed)) {
    reasons.push(`occurred_at must be an ISO 8601 datetime; got '${occurredRaw}'`);
  } else {
    occurredAt = new Date(parsed).toISOString();
  }

  if (reasons.length > 0) {
    return { row: rowNum, reason: reasons.join('; ') };
  }
  return {
    row: rowNum,
    sourceTransactionId,
    lineId: lineIdNorm,
    returnedClickRef: returnedClickRefNorm,
    currency,
    eligibleValueMinor: eligibleValueMinor as number,
    commissionMinor: commissionMinor as number,
    providerStatus,
    providerRevision,
    occurredAt,
  };
}

type RowOutcome = IngestOutcome;

interface RowResult {
  row: number;
  outcome: RowOutcome['kind'];
  conversion_id: string;
  status: string;
  ledger?: 'posted' | 'skipped';
  auto_reversed?: boolean;
  adjustment_id?: string | null;
}

function toRowResult(rowNum: number, outcome: RowOutcome): RowResult {
  const base = { row: rowNum, conversion_id: outcome.conversionId, status: outcome.status };
  switch (outcome.kind) {
    case 'created':
      return { ...base, outcome: 'created', ledger: outcome.ledger };
    case 'deduped':
      return { ...base, outcome: 'deduped' };
    case 'status_changed':
      return { ...base, outcome: 'status_changed', ledger: outcome.ledger };
    case 'auto_reversed':
      return {
        ...base,
        outcome: 'auto_reversed',
        ledger: outcome.ledger,
        auto_reversed: outcome.autoReversed,
        adjustment_id: outcome.adjustmentId,
      };
  }
}

/**
 * POST /v1/integrations/csv/uploads — file-based merchant settlement import.
 *
 * Brief §8: direct merchants without APIs report via files. The uploader
 * POSTs the CSV text inline (no multipart; see the body schema note) with
 * the programme the file belongs to. Every row then goes through the SAME
 * conversion pipeline as the provider webhook (see src/conversion-ingest.ts):
 * idempotency on (provider_account_id, source_transaction_id, line_id),
 * provider_revision ordering, unknown returned_click_ref → suspense
 * (click_id NULL), ledger posting on approved, and the same outbox events.
 *
 * ALL-OR-NOTHING VALIDATION: every row is validated before anything is
 * ingested. If any row is invalid the whole upload is rejected with
 * `422 VALIDATION_ERROR` and per-row `errors: [{row, reason}]` — nothing
 * is inserted (no partial ingestion). `row` is the 1-based data-row number
 * (the header is not counted; blank lines are skipped).
 *
 * Roles: `network_admin`, `editor` — same as the provider webhook.
 *
 * ## CSV column format
 *
 * Header row required; column names are case-insensitive; extra columns are
 * ignored; blank lines are skipped. UTF-8; LF or CRLF.
 *
 * | column | required | notes |
 * |---|---|---|
 * | `source_transaction_id` | yes | provider's transaction id (≤200 chars) |
 * | `line_id` | no | provider's line-item id; empty = null |
 * | `returned_click_ref` | no | matched against `clicks.click_id`; unknown or empty → suspense (never guessed) |
 * | `currency` | yes | 3-letter code, e.g. `INR` (case-insensitive, stored uppercase) |
 * | `eligible_value_minor` | yes | integer ≥ 0 in minor units (paise for INR); **decimals are rejected** |
 * | `commission_minor` | yes | integer ≥ 0 in minor units; **decimals are rejected** |
 * | `provider_status` | yes | one of `approved`\|`pending`\|`declined`\|`reversed` (case-insensitive). `reversed` behaves as `declined` after approval (auto-reversal adjustment), exactly as on the webhook path |
 * | `provider_revision` | no | integer ≥ 0, default 0; same ordering rules as the webhook path (stale revisions are ignored, never downgrade an approval) |
 * | `occurred_at` | yes | ISO 8601 datetime, e.g. `2026-09-20T10:00:00.000Z` |
 *
 * Money is always integer minor units — a value like `12.50` is rejected
 * with a clear reason, not rounded or truncated.
 *
 * Success → `202 { data: { filename, provider_account_id, programme_id,
 * rows_received, created, deduped, status_changed, auto_reversed,
 * results: [{row, outcome, conversion_id, status, ledger?}] } }`.
 * Validation failure → `422 { error: {...}, errors: [{row, reason}] }`.
 * The error code stays `VALIDATION_ERROR` (the shared ErrorCode union is
 * owned elsewhere); the CSV detail lives in `errors`.
 * A `row: 0` error is file-level (bad header / unparseable CSV).
 */
export async function csvUploadsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/integrations/csv/uploads',
    {
      preHandler: [requireAuth, requireRole('network_admin', 'editor'), idempotencyCheck],
    },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const body = parseOr400(CsvUploadBody, req.body);

      if (Buffer.byteLength(body.csv_text, 'utf8') > MAX_CSV_BYTES) {
        throw new AppError(
          'VALIDATION_ERROR',
          `csv_text exceeds the ${MAX_CSV_BYTES}-byte limit for inline uploads`,
          400,
        );
      }

      // The uploader names the programme: it must exist in this org and be active.
      const prog = await tenantQuery<{ id: string; status: string }>(
        orgId,
        `select id, status from programmes where org_id = $1 and id = $2`,
        [body.programme_id],
      );
      const programme = prog.rows[0];
      if (!programme) {
        throw new AppError('NOT_FOUND', `No programme '${body.programme_id}' in this organisation`, 404);
      }
      if (programme.status !== 'active') {
        throw new AppError(
          'VALIDATION_ERROR',
          `Programme '${body.programme_id}' is not active (status '${programme.status}'); CSV settlement uploads require an active programme`,
          422,
        );
      }

      // --- Parse -----------------------------------------------------------
      let records: string[][];
      try {
        records = parseCsv(body.csv_text);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unparseable CSV';
        return reply.code(422).send({
          ...apiError('VALIDATION_ERROR', 'CSV could not be parsed', req.requestId),
          errors: [{ row: 0, reason }],
        });
      }

      const dataRows = records.filter((r) => !isBlankRow(r));
      // A header-only file has no rows to ingest.
      if (dataRows.length <= 1) {
        return reply.code(422).send({
          ...apiError('VALIDATION_ERROR', 'CSV contains no data rows', req.requestId),
          errors: [],
        });
      }

      // --- Header ----------------------------------------------------------
      const header = (dataRows[0] as string[]).map((h) => h.trim().toLowerCase());
      const cols: ColumnIndex = {};
      const seen = new Set<string>();
      let duplicateHeader: string | null = null;
      for (let i = 0; i < header.length; i++) {
        const name = header[i] as string;
        if (seen.has(name) && name !== '') duplicateHeader = duplicateHeader ?? name;
        seen.add(name);
        if (!(name in cols)) cols[name] = i;
      }
      const missingColumns = REQUIRED_COLUMNS.filter((c) => !(c in cols));

      // --- Validate every row BEFORE ingesting anything --------------------
      const errors: RowError[] = [];
      const parsed: ParsedRow[] = [];
      const dataOnly = dataRows.slice(1);
      if (duplicateHeader) {
        for (let n = 0; n < dataOnly.length; n++) {
          errors.push({ row: n + 1, reason: `duplicate column '${duplicateHeader}' in header` });
        }
      } else if (missingColumns.length > 0) {
        const reason = `missing required column(s): ${missingColumns.join(', ')}`;
        for (let n = 0; n < dataOnly.length; n++) errors.push({ row: n + 1, reason });
      } else {
        let n = 0;
        for (const cells of dataOnly) {
          n += 1;
          if (isBlankRow(cells)) continue; // already filtered, defensive
          const result = validateRow(n, cells, cols);
          if ('reason' in result) errors.push(result);
          else parsed.push(result);
        }
      }

      if (errors.length > 0) {
        // All-or-nothing: nothing has been inserted; reject the whole file.
        return reply.code(422).send({
          ...apiError(
            'VALIDATION_ERROR',
            `${errors.length} row(s) failed validation; nothing was ingested`,
            req.requestId,
          ),
          errors,
        });
      }

      // --- Ingest through the shared money path ----------------------------
      const log: IngestLog = req.log;
      const results: RowResult[] = [];
      for (const pr of parsed) {
        const input: ConversionIngestInput = {
          connector: 'csv',
          receivedVia: 'csv',
          programmeId: programme.id,
          providerAccountId: body.provider_account_id,
          sourceTransactionId: pr.sourceTransactionId,
          lineId: pr.lineId,
          returnedClickRef: pr.returnedClickRef,
          currency: pr.currency,
          eligibleValueMinor: pr.eligibleValueMinor,
          commissionMinor: pr.commissionMinor,
          providerStatus: pr.providerStatus,
          providerRevision: pr.providerRevision,
          occurredAt: pr.occurredAt,
        };
        const outcome = await ingestConversionEvent(orgId, input, log);
        results.push(toRowResult(pr.row, outcome));
      }

      const count = (kind: RowOutcome['kind']) => results.filter((r) => r.outcome === kind).length;
      return reply.code(202).send(
        ok(req, {
          filename: body.filename,
          provider_account_id: body.provider_account_id,
          programme_id: programme.id,
          rows_received: dataOnly.length,
          created: count('created'),
          deduped: count('deduped'),
          status_changed: count('status_changed'),
          auto_reversed: count('auto_reversed'),
          results,
        }),
      );
    },
  );
}
