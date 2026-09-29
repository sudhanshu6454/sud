import { defineConfig } from 'vitest/config';

// Test runner config for the paparazzi-platform monorepo.
//
// - Test files live either next to source (packages/<pkg>/src) or in
//   package-local test dirs (packages/<pkg>/test).
// - pool 'forks' (not threads): DB-backed suites swap in pg-mem adapters and
//   there is no benefit to shared-worker isolation here; forks keep each test
//   file in its own process.
// - testTimeout 20000ms: pg-mem schema application is CPU-heavy on first load.
// - No coverage thresholds: this is a functional test suite for a money loop;
//   thresholds would add noise without enforcing the invariants that matter.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 20000,
    pool: 'forks',
    coverage: {
      enabled: false,
    },
  },
});
