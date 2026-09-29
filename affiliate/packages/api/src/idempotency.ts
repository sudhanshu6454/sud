import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from './db.js';
import { authed } from './middleware.js';

interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Idempotency for POST routes via the `Idempotency-Key` header.
 *
 * - preHandler (`idempotencyCheck`): if the key was seen before FOR THE SAME
 *   org, the stored response is replayed with `X-Idempotent-Replay: true`
 *   and the handler is skipped. A key seen under a different org is treated
 *   as new (keys are globally unique, but responses are org-scoped).
 * - onSend (`captureIdempotentResponse`, registered globally): after a
 *   successful (< 500) response, the {status, body} is persisted so a retry
 *   with the same key returns the original result instead of double-applying.
 *
 * Pragmatic notes / TODOs:
 * - No request fingerprinting: the same key with a different body still
 *   replays the first response. Add a body hash comparison if needed.
 * - No distributed lock: two concurrent first-time requests with the same
 *   key can both execute; row-level idempotency keys on writes
 *   (e.g. payout_batches.idempotency_key, ledger_entries.idempotency_key)
 *   are the second line of defense.
 * - Error responses (5xx) are never stored, so a failed attempt can be retried.
 */
export async function idempotencyCheck(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) return; // header optional; without it the route just executes normally
  const tenant = authed(req);
  req.idempotencyKey = key;

  const { rows } = await getPool().query(
    `select response from idempotency_keys where key = $1 and org_id = $2`,
    [key, tenant.org_id],
  );
  const stored = rows[0]?.response as StoredResponse | undefined;
  if (stored && typeof stored.status === 'number') {
    req.log.info({ idempotencyKey: key }, 'replaying stored idempotent response');
    await reply.code(stored.status).header('X-Idempotent-Replay', 'true').send(stored.body);
    return;
  }
  // else: first time we see this key — fall through to the handler
}

export async function registerIdempotencyCapture(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const key = req.idempotencyKey;
    const tenant = req.tenant;
    if (!key || !tenant) return payload;
    if (reply.statusCode >= 500) return payload; // never cache server errors

    let body: unknown = null;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        body = JSON.parse(payload);
      } catch {
        body = payload;
      }
    }
    // NOTE: the stored body embeds the original request_id; a replay returns
    // the original envelope verbatim (documented behavior, not a bug).
    await getPool()
      .query(
        `insert into idempotency_keys (key, org_id, response)
         values ($1, $2, $3::jsonb)
         on conflict (key) do nothing`,
        [key, tenant.org_id, JSON.stringify({ status: reply.statusCode, body })],
      )
      .catch((err: unknown) => {
        req.log.warn({ err, idempotencyKey: key }, 'failed to store idempotent response');
      });
    return payload;
  });
}
