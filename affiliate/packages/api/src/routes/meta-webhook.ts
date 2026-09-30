import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { apiError } from '@paparazzi/shared';
import {
  COMMENT_ID_HASH_KEY_MIN_LENGTH,
  deleteMetaUserData,
  ingestMetaDelivery,
  parseSignedRequest,
  sameSecret,
  verifyMetaSignature,
} from '../looks/replies.js';
import { siteOrigin } from '../looks/instant-links.js';
import { clientKey, webhookRateLimiter } from '../public-guard.js';

// ---------------------------------------------------------------------------
// The Meta webhook for comment replies (Facebook Pages `feed`, Instagram
// `comments`, and messages for opt-outs). Public through the web's /api
// proxy (https://afflino.com/api/v1/integrations/meta/webhook), which keeps
// the raw body bytes and the headers.
//
// GET  verification: hub.mode=subscribe and hub.verify_token equal to
//      META_VERIFY_TOKEN (constant-time) → the hub.challenge as text/plain;
//      otherwise 403 (503 while META_VERIFY_TOKEN is unset).
// POST deliveries: registered in its own plugin whose JSON parser keeps the
//      RAW bytes, so X-Hub-Signature-256 is checked over exactly what Meta
//      signed (Meta signs the escaped-unicode payload; re-serialised JSON
//      would not match). META_APP_SECRET or COMMENT_ID_HASH_KEY unset → 503;
//      a missing or wrong signature → 401 and nothing is read; otherwise the
//      delivery is taken in (src/looks/replies.ts ingestMetaDelivery) and
//      answered 200 at once (the private replies are the workers' job).
// POST /v1/integrations/meta/data-deletion: Meta's data deletion callback
//      (App settings > Basic). `signed_request` = base64url(signature) "."
//      base64url(payload), the signature HMAC-SHA256(META_APP_SECRET, the
//      encoded payload), checked in constant time (401 otherwise); every
//      reply event whose commenter hash is that person's (on any of the
//      in-house accounts) is deleted; the opt-out list keeps its hash (no
//      message may ever go to them again: counsel's question, Q14);
//      answered { url, confirmation_code } as Meta requires.
// Both POSTs are rate-limited per client (src/public-guard.ts, 429).
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export async function metaWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/integrations/meta/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = env('META_VERIFY_TOKEN');
    if (!token) return reply.code(503).send(apiError('UPSTREAM_UNAVAILABLE', 'comment replies are not configured', req.requestId));
    const q = req.query as Record<string, unknown>;
    const mode = typeof q['hub.mode'] === 'string' ? q['hub.mode'] : '';
    const given = typeof q['hub.verify_token'] === 'string' ? q['hub.verify_token'] : '';
    const challenge = typeof q['hub.challenge'] === 'string' ? q['hub.challenge'] : '';
    if (mode !== 'subscribe' || !sameSecret(given, token) || !/^[A-Za-z0-9_-]{1,128}$/.test(challenge)) {
      return reply.code(403).send(apiError('FORBIDDEN', 'verification refused', req.requestId));
    }
    return reply.code(200).type('text/plain').header('cache-control', 'no-store').send(challenge);
  });

  await app.register(async (scope) => {
    // Raw bytes for every content type this route may receive.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_BODY_BYTES }, (_req, body, done) => done(null, body));

    scope.addHook('onRequest', async (req, reply) => {
      const t = webhookRateLimiter().take(clientKey(req.ip));
      if (!t.ok) {
        reply.header('retry-after', String(t.retryAfter));
        return reply.code(429).send(apiError('RATE_LIMITED', 'too many requests; try again shortly', req.requestId));
      }
      return undefined;
    });

    scope.post('/v1/integrations/meta/data-deletion', { bodyLimit: 64 * 1024 }, async (req: FastifyRequest, reply: FastifyReply) => {
      const secret = env('META_APP_SECRET');
      const hashKey = env('COMMENT_ID_HASH_KEY');
      if (!secret || !hashKey || hashKey.length < COMMENT_ID_HASH_KEY_MIN_LENGTH) {
        return reply.code(503).send(apiError('UPSTREAM_UNAVAILABLE', 'comment replies are not configured', req.requestId));
      }
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      const signed = new URLSearchParams(raw).get('signed_request') ?? '';
      const parsed = parseSignedRequest(signed, secret);
      if (!parsed) return reply.code(401).send(apiError('UNAUTHORIZED', 'signed_request missing or invalid', req.requestId));
      const out = await deleteMetaUserData(parsed.user_id, hashKey);
      req.log.info({ meta_data_deletion: { events_deleted: out.events_deleted, accounts: out.accounts } }, 'meta data deletion request taken in');
      return reply
        .code(200)
        .header('cache-control', 'no-store')
        .send({ url: `${siteOrigin()}/privacy#data-deletion`, confirmation_code: out.confirmation_code });
    });

    scope.post('/v1/integrations/meta/webhook', { bodyLimit: MAX_BODY_BYTES }, async (req: FastifyRequest, reply: FastifyReply) => {
      const secret = env('META_APP_SECRET');
      const hashKey = env('COMMENT_ID_HASH_KEY');
      if (!secret || !hashKey || hashKey.length < COMMENT_ID_HASH_KEY_MIN_LENGTH) {
        return reply.code(503).send(apiError('UPSTREAM_UNAVAILABLE', 'comment replies are not configured', req.requestId));
      }
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'], secret)) {
        return reply.code(401).send(apiError('UNAUTHORIZED', 'signature missing or invalid', req.requestId));
      }
      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.code(400).send(apiError('VALIDATION_ERROR', 'the body is not JSON', req.requestId));
      }
      const summary = await ingestMetaDelivery(body, hashKey);
      req.log.info({ meta_webhook: summary }, 'meta webhook delivery taken in');
      return reply.code(200).send({ data: summary, request_id: req.requestId });
    });
  });
}
