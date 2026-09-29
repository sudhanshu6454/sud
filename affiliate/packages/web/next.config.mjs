import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // docker/Dockerfile.web copies .next/standalone and runs packages/web/server.js,
  // which is the layout produced when the trace root is the monorepo root.
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: path.join(here, '..', '..'),
  },
  // Same-origin API proxy: /api/* is served by app/api/[...path]/route.ts,
  // which resolves API_BASE at request time (a config rewrite would freeze
  // the destination at build time — see that file).
};

export default nextConfig;
