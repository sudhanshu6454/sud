// OpenAPI spec conformance: docs/openapi.yaml must parse as OpenAPI 3.1 and
// document every route the API registers — nothing invented, nothing missing.
//
// EXPECTED_ROUTES is a deliberate mirror of the route registrations in
// src/routes/*.ts (+ /healthz in src/index.ts). It is pinned to reality with
// app.hasRoute(): adding or removing a route without updating both this list
// and docs/openapi.yaml fails the suite. Fastify `:param` segments map to
// OpenAPI `{param}` segments in the spec.

process.env.DATABASE_URL ??= 'postgres://openapi-conformance/dummy';
process.env.JWT_SECRET ??= 'openapi-test-secret';

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { ERROR_CODES } from '@paparazzi/shared';

// NOTE: src/index.js is imported dynamically inside the test (see below):
// db.ts throws at import time when DATABASE_URL is unset, and static imports
// are hoisted above the process.env assignments at the top of this file.

const SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'openapi.yaml');

type HttpMethod = 'GET' | 'POST';

const EXPECTED_ROUTES: Array<{ method: HttpMethod; url: string }> = [
  { method: 'GET', url: '/healthz' },
  { method: 'GET', url: '/v1/looks' },
  { method: 'GET', url: '/v1/looks/:id' },
  { method: 'GET', url: '/v1/offers' },
  { method: 'POST', url: '/v1/links' },
  { method: 'POST', url: '/v1/integrations/:connector/events' },
  { method: 'POST', url: '/v1/integrations/stub-network/payout-callback' },
  { method: 'POST', url: '/v1/integrations/csv/uploads' },
  { method: 'POST', url: '/v1/integrations/amazon-associates/reports' },
  { method: 'GET', url: '/v1/suspense' },
  { method: 'POST', url: '/v1/suspense/:id/retry' },
  { method: 'POST', url: '/v1/suspense/:id/review' },
  { method: 'POST', url: '/v1/payout-batches' },
  { method: 'POST', url: '/v1/payout-batches/:id/approve' },
  { method: 'POST', url: '/v1/payout-batches/:id/disburse' },
  { method: 'POST', url: '/v1/payout-transfers/:providerRef/status-query' },
  { method: 'GET', url: '/v1/publisher/earnings' },
  { method: 'POST', url: '/v1/programmes/:id/pause' },
  { method: 'POST', url: '/v1/programmes/:id/resume' },
  { method: 'POST', url: '/v1/publishers' },
  { method: 'GET', url: '/v1/publishers/:id' },
  { method: 'POST', url: '/v1/publishers/:id/onboarding/advance' },
  { method: 'POST', url: '/v1/disputes' },
  { method: 'GET', url: '/v1/disputes' },
  { method: 'GET', url: '/v1/disputes/:id' },
  { method: 'POST', url: '/v1/disputes/:id/resolve' },
  { method: 'POST', url: '/v1/contracts' },
  { method: 'GET', url: '/v1/contracts' },
  { method: 'POST', url: '/v1/contracts/:id/approve' },
  // celebrity looks (0007)
  { method: 'GET', url: '/v1/public/:org/spotted' },
  { method: 'GET', url: '/v1/public/:org/celebrities/:slug' },
  { method: 'GET', url: '/v1/public/:org/looks/:id' },
  { method: 'GET', url: '/v1/public/:org/looks/:id/still' },
  { method: 'GET', url: '/v1/public/:org/storefronts/:slug' },
  { method: 'GET', url: '/v1/public/:org/sitemap' },
  { method: 'GET', url: '/v1/public/:org/trending' },
  { method: 'GET', url: '/v1/celebrities' },
  { method: 'POST', url: '/v1/celebrities' },
  { method: 'GET', url: '/v1/celebrities/:id' },
  { method: 'POST', url: '/v1/celebrities/:id' },
  { method: 'POST', url: '/v1/celebrities/:id/rights-review' },
  { method: 'GET', url: '/v1/editorial/looks' },
  { method: 'POST', url: '/v1/editorial/looks' },
  { method: 'GET', url: '/v1/editorial/looks/:id' },
  { method: 'POST', url: '/v1/editorial/looks/:id' },
  { method: 'POST', url: '/v1/editorial/looks/:id/transition' },
  { method: 'POST', url: '/v1/editorial/looks/:id/links' },
  { method: 'POST', url: '/v1/editorial/looks/:id/confirm-place' },
  { method: 'POST', url: '/v1/editorial/looks/:id/pieces' },
  { method: 'POST', url: '/v1/editorial/pieces/:id' },
  { method: 'POST', url: '/v1/editorial/pieces/:id/remove' },
  { method: 'POST', url: '/v1/editorial/pieces/:id/items' },
  { method: 'POST', url: '/v1/editorial/look-items/:id/review' },
  { method: 'POST', url: '/v1/editorial/look-items/:id/remove' },
  { method: 'POST', url: '/v1/editorial/assets/:id' },
  { method: 'POST', url: '/v1/editorial/instant-links' },
  { method: 'GET', url: '/v1/editorial/properties' },
  { method: 'POST', url: '/v1/editorial/library/import' },
  { method: 'GET', url: '/v1/editorial/storefronts' },
  { method: 'POST', url: '/v1/editorial/storefronts' },
  { method: 'POST', url: '/v1/editorial/storefronts/:id' },
  { method: 'GET', url: '/v1/takedowns' },
  { method: 'POST', url: '/v1/takedowns' },
  { method: 'GET', url: '/v1/takedowns/:id' },
  { method: 'POST', url: '/v1/takedowns/:id/restore' },
  { method: 'POST', url: '/v1/takedowns/:id/posts-removed' },
  { method: 'GET', url: '/v1/replies/rules' },
  { method: 'POST', url: '/v1/replies/rules' },
  { method: 'POST', url: '/v1/replies/rules/:id' },
  { method: 'GET', url: '/v1/replies/rules/:id/events' },
  { method: 'GET', url: '/v1/replies/events' },
  { method: 'GET', url: '/v1/replies/accounts' },
  { method: 'POST', url: '/v1/replies/accounts' },
  { method: 'GET', url: '/v1/integrations/meta/webhook' },
  { method: 'POST', url: '/v1/integrations/meta/webhook' },
  { method: 'POST', url: '/v1/integrations/meta/data-deletion' },
  { method: 'GET', url: '/v1/analytics/clicks' },
  { method: 'GET', url: '/v1/analytics/replies' },
];

/** Fastify `:param` → OpenAPI `{param}`. */
function toOpenApiPath(fastifyUrl: string): string {
  return fastifyUrl.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

interface OpenApiDocument {
  openapi: string;
  info?: { title?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: { ErrorCode?: { enum?: string[] } };
    securitySchemes?: { bearerAuth?: { type?: string; scheme?: string; description?: string } };
  };
}

function loadSpec(): OpenApiDocument {
  return parseYaml(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;
}

describe('openapi spec conformance', () => {
  it('parses as OpenAPI 3.1', () => {
    const spec = loadSpec();
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info?.title).toBeTruthy();
    expect(spec.paths).toBeTypeOf('object');
  });

  it('pins the expected route list to the real app (hasRoute)', async () => {
    // Dynamic import: runs after the process.env assignments above, so db.ts
    // sees DATABASE_URL (same pattern as phase3.test.ts).
    const { buildApp } = await import('../src/index.js');
    const app = await buildApp();
    try {
      for (const route of EXPECTED_ROUTES) {
        expect(
          app.hasRoute({ method: route.method, url: route.url }),
          `${route.method} ${route.url} is not registered by the app — update EXPECTED_ROUTES`,
        ).toBe(true);
      }
    } finally {
      await app.close();
    }
  });

  it('documents every registered route path+method', () => {
    const spec = loadSpec();
    for (const route of EXPECTED_ROUTES) {
      const path = toOpenApiPath(route.url);
      const pathItem = spec.paths[path];
      expect(pathItem, `spec is missing path ${path}`).toBeDefined();
      expect(
        pathItem?.[route.method.toLowerCase()],
        `spec is missing ${route.method} on ${path}`,
      ).toBeDefined();
    }
  });

  it('documents no routes the app does not register', () => {
    const spec = loadSpec();
    const expected = new Set(EXPECTED_ROUTES.map((r) => `${r.method} ${toOpenApiPath(r.url)}`));
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const method of Object.keys(pathItem)) {
        // 'parameters' is a path-item-level key, not an operation.
        if (method === 'parameters') continue;
        expect(
          expected.has(`${method.toUpperCase()} ${path}`),
          `spec documents ${method.toUpperCase()} ${path}, which the app does not register — remove it`,
        ).toBe(true);
      }
    }
  });

  it('error-code enum matches the shared contract', () => {
    const spec = loadSpec();
    const specCodes = spec.components?.schemas?.ErrorCode?.enum;
    expect(specCodes).toBeDefined();
    expect(new Set(specCodes)).toEqual(new Set<string>(ERROR_CODES));
  });

  it('marks the bearer auth scheme as a temporary stub', () => {
    const spec = loadSpec();
    const scheme = spec.components?.securitySchemes?.bearerAuth;
    expect(scheme?.type).toBe('http');
    expect(scheme?.scheme).toBe('bearer');
    expect(scheme?.description ?? '').toMatch(/temporary stub/i);
  });
});
