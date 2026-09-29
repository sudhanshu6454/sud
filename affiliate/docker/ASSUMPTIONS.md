# docker/ — assumptions and decisions

## 2026-09-29 — images that build and boot

1. **Base + package manager.** `node:22-alpine` for every stage; pnpm 10.34.6
   via corepack with `COREPACK_ENABLE_PROJECT_SPEC=0`, because `package.json`
   still pins `packageManager: pnpm@9.12.0` and corepack would otherwise run
   that version regardless of `corepack prepare`. Both versions were verified
   to accept `pnpm-lock.yaml` under `--frozen-lockfile`; `PNPM_VERSION` and
   `NODE_IMAGE` are build args so neither is hard-wired.
2. **`@paparazzi/shared` at runtime.** The repo keeps `main: ./src/index.ts`
   (tsx and vitest read TypeScript). Inside the service images the package is
   compiled once to `packages/shared/dist` (+ `.d.ts`) and the image's copy of
   its `package.json` is repointed at `dist/`; the services are then emitted
   with `tsc … --rootDir src --outDir dist` as CommonJS. Chosen over an esbuild
   bundle because `typescript` is a direct devDependency everywhere while
   esbuild is only tsx's transitive dependency, and because the emitted tree
   mirrors `src/` one-to-one. If the coordinator later adds a real `build`
   script to `packages/shared`, `docker/build-service.sh` step 2 becomes
   redundant and can call it instead.
3. **Runtime layout mirrors the repo** (`/app/node_modules/.pnpm`,
   `/app/packages/<svc>/node_modules`, `/app/packages/shared`) so pnpm's
   relative symlinks stay valid; production dependencies come from a separate
   `pnpm install --prod --filter <svc>...` stage on the same lockfile.
4. **migrate image** installs `pg 8.23.0`, `yaml 2.9.1`, `tsx 4.23.15` from
   `docker/migrate.package.json` with npm (direct versions pinned to the
   workspace lockfile; transitive versions resolve at build time — acceptable
   for a one-shot runner, revisit if reproducibility of that image matters) and
   symlinks `packages/api/node_modules` to them, because the `db/` scripts
   `createRequire('../packages/api/node_modules/…')`. `NODE_ENV` is left unset
   so `seed-fleet.ts --with-demo-programme` can run; the guard is the script's,
   not the image's.
5. **Non-root.** All five images run as `node`; the web's fetch cache directory
   is owned by `node`. No `HEALTHCHECK` in the Dockerfiles — the compose files
   own the probes.
6. **Tests are excluded from the build context** (`packages/*/test`,
   `**/*.test.ts`) so `next build`'s type check does not need vitest and the
   shared compile does not emit `ledger.test.js`.
7. **`docker-compose.prod.yml`** now requires `REDIRECT_BASE_URL`,
   `WEB_API_TOKEN` and `WEB_PLACEMENT_ID` in addition to the previous four
   secrets/URLs; the web proxies `/api/*` to `API_BASE` (default
   `http://api:3000`) and `NEXT_PUBLIC_API_BASE` defaults to `/api`. The
   `migrate` service mounts `${FLEET_SITES_DIR:-../autopub/config}` at
   `/app/config` for `seed-fleet.ts`. Port publishing is unchanged (3000, 3001,
   3002 on all interfaces — the LB/private network fronts them; the fleet host
   uses the root compose with nginx-proxy instead).
8. **Sandbox caveat.** The builds were verified with `NODE_IMAGE` pointing at a
   local `node:22-alpine` derivative carrying the sandbox's egress CA (the only
   way to reach the npm registry from inside a build here). The Dockerfiles
   contain no proxy or CA settings; the `:test` images built in the sandbox
   carry a `NODE_EXTRA_CA_CERTS` env from that base and must not be shipped.
