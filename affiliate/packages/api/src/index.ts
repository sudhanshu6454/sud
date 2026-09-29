import Fastify from 'fastify';
import { requestIdHook } from './middleware.js';
import { registerIdempotencyCapture } from './idempotency.js';
import { registerErrorHandling } from './errors.js';
import { looksRoutes } from './routes/looks.js';
import { offersRoutes } from './routes/offers.js';
import { linksRoutes } from './routes/links.js';
import { integrationsRoutes } from './routes/integrations.js';
import { csvUploadsRoutes } from './routes/csv-uploads.js';
import { earningsRoutes } from './routes/earnings.js';
import { payoutsRoutes } from './routes/payouts.js';
import { programmesRoutes } from './routes/programmes.js';
import { publishersRoutes } from './routes/publishers.js';
import { disputesRoutes } from './routes/disputes.js';
import { contractsRoutes } from './routes/contracts.js';
import { suspenseRoutes } from './routes/suspense.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

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
  await app.register(earningsRoutes);
  await app.register(payoutsRoutes);
  await app.register(programmesRoutes);
  await app.register(publishersRoutes);
  await app.register(disputesRoutes);
  await app.register(contractsRoutes);
  await app.register(suspenseRoutes);

  return app;
}

async function main() {
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
