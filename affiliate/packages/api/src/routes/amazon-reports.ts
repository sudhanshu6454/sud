import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError, AppError } from '@paparazzi/shared';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { amazonAccountById, amazonAccountsOfOrg } from '../amazon/account.js';
import { importAmazonEarningsReport, MAX_REPORT_BYTES } from '../amazon/report-import.js';
import { ok, parseOr400 } from './_helpers.js';

const ReportBody = z.object({
  /** amazon_associates_accounts.id; optional when the organisation has exactly one account. */
  account_id: z.string().uuid().optional(),
  filename: z.string().min(1).max(255),
  /**
   * The downloaded report as text (tab- or comma-separated), inline like the
   * CSV connector's csv_text. Capped at MAX_REPORT_BYTES.
   */
  report_text: z.string().min(1),
});

/**
 * POST /v1/integrations/amazon-associates/reports — import an Amazon.in
 * Associates earnings report (src/amazon/report-import.ts; the layout table
 * is src/amazon/report-format.ts, EARNINGS_COLUMNS, "layout to confirm with a
 * real export").
 *
 * Every shipped row goes through the one money path (ingestConversionEvent:
 * idempotency on (account_ref, source_transaction_id, 'shipped'), revision
 * ordering, attribution by sub-tag → tracking-ID mapping → suspense, ledger
 * on approval); every return row through ingestReturnEvent (a deterministic
 * reversal on the one matching sale, or reported as unmatched).
 *
 * 202 → the import summary. 422 → the file was refused (unknown layout, a
 * row that does not validate, a duplicate row, an inactive programme):
 * nothing was written, `errors: [{row, reason}]` says why. 409 → a row was
 * imported before with different amounts: nothing was written. Roles:
 * network_admin, editor (as the other provider adapters).
 */
export async function amazonReportsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/integrations/amazon-associates/reports',
    {
      // JSON escaping of tabs and quotes makes the body larger than the text it carries.
      bodyLimit: MAX_REPORT_BYTES * 2 + 64 * 1024,
      preHandler: [requireAuth, requireRole('network_admin', 'editor'), idempotencyCheck],
    },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const body = parseOr400(ReportBody, req.body);

      let account;
      if (body.account_id) {
        account = await amazonAccountById(orgId, body.account_id);
        if (!account) throw new AppError('NOT_FOUND', 'No Amazon Associates account with this id in this organisation', 404);
      } else {
        const all = await amazonAccountsOfOrg(orgId);
        if (all.length === 0) throw new AppError('NOT_FOUND', 'This organisation has no Amazon Associates account', 404);
        if (all.length > 1) {
          throw new AppError('VALIDATION_ERROR', 'This organisation has several Amazon Associates accounts; name one with account_id', 400);
        }
        account = all[0];
      }
      if (!account) throw new AppError('NOT_FOUND', 'No Amazon Associates account', 404);

      const result = await importAmazonEarningsReport({
        orgId,
        account,
        text: body.report_text,
        receivedVia: 'api',
        log: req.log,
      });
      if (!result.ok) {
        return reply.code(result.status).send({
          ...apiError(result.code, result.message, req.requestId),
          errors: result.errors,
        });
      }
      return reply.code(202).send(ok(req, { filename: body.filename, ...result.summary }));
    },
  );
}
