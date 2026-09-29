import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a dev server run in .next-dev while builds use .next
  // (e.g. NEXT_DIST_DIR=.next-dev next dev -p 3311 next to next start).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // docker/Dockerfile.web copies .next/standalone and runs packages/web/server.js,
  // which is the layout produced when the trace root is the monorepo root.
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: path.join(here, '..', '..'),
  },
  // Same-origin API proxy: /api/* is served by app/api/[...path]/route.ts,
  // which resolves API_BASE at request time (a config rewrite would freeze
  // the destination at build time — see that file).

  // The publisher portal and editorial console moved into the Afflino app
  // and admin areas. Temporary (307) until the new screens are settled.
  async redirects() {
    return [
      { source: '/portal', destination: '/app', permanent: false },
      { source: '/portal/links', destination: '/app/links', permanent: false },
      { source: '/portal/statements', destination: '/app/payouts/statements', permanent: false },
      { source: '/portal/disputes', destination: '/app/payouts/disputes', permanent: false },
      { source: '/console', destination: '/admin/looks', permanent: false },
      { source: '/console/looks/:id', destination: '/admin/looks/:id', permanent: false },
      { source: '/console/suspense', destination: '/admin/suspense', permanent: false },
    ];
  },
};

export default nextConfig;
