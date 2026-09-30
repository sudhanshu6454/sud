import Fastify from 'fastify';
import { parseTrustProxy, requestLogFields } from '@paparazzi/shared';
import { requestIdHook } from './middleware.js';
import { registerIdempotencyCapture } from './idempotency.js';
import { registerErrorHandling } from './errors.js';
import { looksRoutes } from './routes/looks.js';
import { offersRoutes } from './routes/offers.js';
import { linksRoutes } from './routes/links.js';
import { integrationsRoutes } from './routes/integrations.js';
import { csvUploadsRoutes } from './routes/csv-uploads.js';
import { amazonReportsRoutes } from './routes/amazon-reports.js';
import { earningsRoutes } from './routes/earnings.js';
import { payoutsRoutes } from './routes/payouts.js';
import { programmesRoutes } from './routes/programmes.js';
import { publishersRoutes } from './routes/publishers.js';
import { disputesRoutes } from './routes/disputes.js';
import { contractsRoutes } from './routes/contracts.js';
import { suspenseRoutes } from './routes/suspense.js';
import { publicRoutes } from './routes/public.js';
import { celebritiesRoutes } from './routes/celebrities.js';
import { editorialRoutes } from './routes/editorial.js';
import { takedownsRoutes } from './routes/takedowns.js';
import { repliesRoutes } from './routes/replies.js';
import { metaWebhookRoutes } from './routes/meta-webhook.js';
import { analyticsRoutes } from './routes/analytics.js';

/**
 * TRUST_PROXY (unset = trust nothing: `req.ip` is the TCP peer) becomes
 * Fastify's `trustProxy` via `parseTrustProxy` (@paparazzi/shared). Behind
 * the edge, docker-compose.prod.yml sets `loopback,uniquelocal`: browser
 * calls reach the API through Caddy and the web's /api proxy, and Caddy
 * overwrites any client-supplied X-Forwarded-For. An invalid value throws
 * here, at boot.
 *
 * The request log records method, url and hostname only
 * (`requestLogFields`): with TRUST_PROXY set, `req.ip` is the visitor's real
 * address, and Fastify's default serializer would log it in the clear.
 * `opts.logStream` is a test seam (default: stdout).
 */
export async function buildApp(opts: { logStream?: { write(line: string): void } } = {}) {
  const app = Fastify({
    logger: {
      level: 'info',
      serializers: { req: requestLogFields },
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  });

  await requestIdHook(app);
  await registerIdempotencyCapture(app);
  await registerErrorHandling(app);

  // No auth — liveness probe.
  app.get('/healthz', async () => ({ ok: true }));

  await app.register(looksRoutes);
  await app.register(offersRoutes);
  await app.register(linksRoutes);
  await app.register(integrationsRoutes);
  await app.register(csvUploadsRoutes);
  await app.register(amazonReportsRoutes);
  await app.register(earningsRoutes);
  await app.register(payoutsRoutes);
  await app.register(programmesRoutes);
  await app.register(publishersRoutes);
  await app.register(disputesRoutes);
  await app.register(contractsRoutes);
  await app.register(suspenseRoutes);
  // Celebrity looks (0007): public reads, the editors' API, takedowns,
  // comment replies and their Meta webhook, analytics.
  await app.register(publicRoutes);
  await app.register(celebritiesRoutes);
  await app.register(editorialRoutes);
  await app.register(takedownsRoutes);
  await app.register(repliesRoutes);
  await app.register(metaWebhookRoutes);
  await app.register(analyticsRoutes);

  return app;
}

async function main() {
  // Redis is best-effort per request (redis.ts), but a production API without
  // it would warm no route cache and invalidate none on a kill switch pull.
  // docker-compose.prod.yml no longer refuses an empty REDIS_URL itself
  // (docker-compose.single-host.yml supplies it), so the boot does.
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL?.trim()) {
    throw new Error('REDIS_URL is required in production');
  }
  const app = await buildApp();
  const port = Number(process.env.API_PORT ?? 3000);
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen({ port, host });
}

// Importing this module must not bind a port: main() runs only when the
// module is the entry point (`pnpm --filter @paparazzi/api dev` →
// `tsx src/index.ts`). Test/demo harnesses import buildApp() directly and
// inject requests without a listener. (CJS idiom, same as the redirect
// package: tsx runs this file as CommonJS.)
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
