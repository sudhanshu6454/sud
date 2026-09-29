# docker/ — the five Paparazzi images

Every Dockerfile here is built from the **repository root** (`affiliate/`) as its
context; `.dockerignore` trims that context to sources, manifests, `db/` and
`docker/` (no `node_modules`, `.next`, `dist`, tests, docs or `.env` files other
than the two committed examples).

| Image | Dockerfile | Runs | Listens | Entrypoint (WORKDIR) |
|---|---|---|---|---|
| `paparazzi/api` | `Dockerfile.api` | `@paparazzi/api` (Fastify v1 API) | 3000 | `node dist/index.js` (`/app/packages/api`) |
| `paparazzi/redirect` | `Dockerfile.redirect` | `@paparazzi/redirect` (`GET /r/{token}`) | 3001 | `node dist/index.js` (`/app/packages/redirect`) |
| `paparazzi/workers` | `Dockerfile.workers` | `@paparazzi/workers` (BullMQ) | — | `node dist/index.js` (`/app/packages/workers`); one-off purge: `node dist/retention/run-once.js [--dry-run]` |
| `paparazzi/web` | `Dockerfile.web` | `@paparazzi/web` (Next.js 14 standalone) | 3000 | `node packages/web/server.js` (`/app`) |
| `paparazzi/migrate` | `Dockerfile.migrate` | `db/migrate.mjs`, `db/seed.ts`, `db/seed-fleet.ts` | — | `node db/migrate.mjs` (`/app`) |

All five run as the unprivileged `node` user (uid 1000); every copied file is
`chown`ed to it, so the images work under `cap_drop: [ALL]` +
`no-new-privileges` (the root `docker-compose.yml` sets both).

## Build

From `affiliate/`:

```
docker build -f docker/Dockerfile.api -t paparazzi/api:latest .
docker build -f docker/Dockerfile.redirect -t paparazzi/redirect:latest .
docker build -f docker/Dockerfile.workers -t paparazzi/workers:latest .
docker build -f docker/Dockerfile.web --build-arg NEXT_PUBLIC_API_BASE=/api -t paparazzi/web:latest .
docker build -f docker/Dockerfile.migrate -t paparazzi/migrate:latest .
```

Build args (all optional):

| Arg | Default | Meaning |
|---|---|---|
| `NODE_IMAGE` | `node:22-alpine` | Base image for every stage (use a mirror, or a derived image with an extra CA). |
| `PNPM_VERSION` | `10.34.6` | pnpm used by the build stages (api, redirect, workers, web). |
| `NEXT_PUBLIC_API_BASE` | `/api` | web only; inlined into the browser bundle. `/api` = the same-origin proxy served by the web server; an absolute URL makes the browser call the API directly. |

Measured on 2026-09-29 (`docker build --no-cache`, node 22.23.3 base = 238 MB as
reported by the containerd snapshotter): see the size table at the end.

## How the services are built (api, redirect, workers)

The three service images share `docker/build-service.sh`:

1. `pnpm install --frozen-lockfile --filter "@paparazzi/<svc>..."` installs the
   service plus its workspace dependency `@paparazzi/shared` (nothing else — no
   `next`, no root dev tools).
2. **`@paparazzi/shared` is TypeScript-source-only in the repo** (`main:
   ./src/index.ts`, consumed by tsx/vitest). In the image it is compiled once
   with `docker/tsconfig.shared.json` to `packages/shared/dist` (JS + `.d.ts`,
   `ledger.test.ts` excluded), and **the image's copy** of
   `packages/shared/package.json` is repointed at `dist/` (`main`, `types`,
   `exports`). The repository file is untouched, so local tooling keeps reading
   TypeScript.
3. The service is type-checked (`pnpm --filter @paparazzi/<svc> typecheck`, the
   same command CI runs) and then emitted with
   `tsc -p tsconfig.json --noEmit false --rootDir src --outDir dist`. Because
   `@paparazzi/shared` now resolves to `.d.ts` files, `rootDir` stays `src` and
   the entry lands at `dist/index.js`. The packages have no `"type": "module"`,
   so NodeNext emits CommonJS — the same module kind tsx uses in development,
   which is why the `require.main === module` entry guards keep working.
4. A separate `prod-deps` stage runs `pnpm install --frozen-lockfile --prod
   --filter "@paparazzi/<svc>..."` from the same lockfile: production
   dependencies only, no TypeScript, no `@types`.
5. The runtime stage copies `node_modules` (the `.pnpm` store),
   `packages/<svc>/node_modules` (pnpm's relative symlinks into that store),
   `packages/shared/{package.json,dist}`, `packages/<svc>/{package.json,dist}`
   and — for the api — `packages/api/scripts`. **The repo layout is preserved**
   so every pnpm symlink (`../../../node_modules/.pnpm/...`,
   `@paparazzi/shared -> ../../../shared`) resolves exactly as it did at install
   time. The first-cut images copied those directories to other paths, which
   broke the links; that is what "runtime stages copy pnpm's symlinked
   node_modules in ways that break" referred to.

Why tsc + a compiled `shared/dist` rather than an esbuild bundle: `typescript`
is a direct devDependency of every package and already the type-check tool,
while esbuild is only present transitively (a dependency of `tsx`); bundling
would also hide the module graph the tests exercise. The emitted `dist/` mirrors
`src/` one-to-one, so stack traces and `dist/retention/run-once.js` map
straight back to the sources.

## pnpm version policy

The build stages use `corepack prepare pnpm@${PNPM_VERSION}` with
`COREPACK_ENABLE_PROJECT_SPEC=0`, so the version pinned in the Dockerfile is
the one used even though `package.json` pins `packageManager: pnpm@9.12.0`
(without that flag corepack would silently run 9.12.0 instead). Both 9.12.0
and 10.34.6 were verified to accept the checked-in `pnpm-lock.yaml`
(`lockfileVersion: '9.0'`) under `--frozen-lockfile`. pnpm 10 does not run
dependency `postinstall` scripts unless allow-listed; the only one in this tree
is esbuild's optional binary check, which the images do not need. When
`packageManager` moves to pnpm 10, drop the flag or keep the two in step —
`PNPM_VERSION` is a build arg, so no Dockerfile edit is needed to test another
version.

## web

`next.config.mjs` sets `output: 'standalone'` with
`experimental.outputFileTracingRoot` = the monorepo root, so the traced bundle
is `/app/packages/web/server.js` plus a pruned `/app/node_modules`. The image
copies that bundle, `.next/static` and `public/`. `next build` type-checks the
app itself (tests are excluded from the context so the check does not need
vitest). The server writes its fetch cache to
`/app/packages/web/.next/cache/fetch-cache`, which is owned by `node`.

Runtime environment (read on every request, never baked — see
`packages/web/README.md`):

| Var | Purpose |
|---|---|
| `API_BASE` | API origin as seen from the web container (compose: `http://api:3000`); also the target of the `/api/*` proxy. |
| `WEB_API_TOKEN` | Read-only bearer (`publisher_analyst`) for catalogue reads. Server-side only. Missing → TEST demo data with a badge. |
| `WEB_PLACEMENT_ID` | The shop's own placement; items carry tracked links only for it. |
| `NEXT_PUBLIC_SITE_NAME` | Site name in `<title>`, header, footer, manifest (a rename is a restart). |
| `HOSTNAME` / `PORT` | Set to `0.0.0.0` / `3000` in the image. |

## migrate

`db/migrate.mjs`, `db/seed.ts` and `db/seed-fleet.ts` borrow `pg` and `yaml`
from `../packages/api/node_modules` (relative to `db/`) via `createRequire`. The
image keeps that path: `docker/migrate.package.json` installs `pg 8.23.0`,
`yaml 2.9.1` and `tsx 4.23.15` (the versions resolved in the workspace
`pnpm-lock.yaml`) into `/app/node_modules`, and `/app/packages/api/node_modules`
is a symlink to it. `db/` is copied verbatim. Commands (`DATABASE_URL`
required, WORKDIR `/app`):

```
node db/migrate.mjs
node db/migrate.mjs --status
node db/migrate.mjs --baseline
./node_modules/.bin/tsx db/seed.ts
./node_modules/.bin/tsx db/seed-fleet.ts --with-demo-programme
```

`seed-fleet.ts` reads `FLEET_SITES_YAML` (compose mounts the fleet's
`autopub/config` at `/app/config` and sets `/app/config/sites.yaml`) and
`AFFILIATE_WEB_HOST` (creates the shop's `web` property and, with
`--with-demo-programme`, the placement reported as `web_placement_id`).
`NODE_ENV` is deliberately **not** set in this image: `--with-demo-programme`
seeds TEST-labelled rows and refuses to run under `NODE_ENV=production`. Pass
`-e NODE_ENV=production` to a run when that guard is wanted.

## Operator scripts shipped in the api image

`mint-dev-token.mjs` is the dev-grade JWT stub (the API trusts its claims
verbatim until the IdP lands); `mint-links.mjs` mints one tracked link per live
offer for a placement (`--dry-run` to preview). With the fleet seed's JSON saved
as `seed-fleet.json` (see the smoke test), a read-only token for the shop and
the links for its placement are:

```
WEB_API_TOKEN=$(docker run --rm -e JWT_SECRET="$JWT_SECRET" paparazzi/api:latest node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-fleet.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_analyst --sub web-shop)
OWNER_TOKEN=$(docker run --rm -e JWT_SECRET="$JWT_SECRET" paparazzi/api:latest node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-fleet.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_owner --sub fleet-owner)
docker run --rm --network NETWORK_NAME -e API_BASE=http://api:3000 -e API_TOKEN="$OWNER_TOKEN" paparazzi/api:latest node scripts/mint-links.mjs --placement "$(grep -m1 '"web_placement_id"' seed-fleet.json | sed 's/.*: "\(.*\)".*/\1/')"
```

(`NETWORK_NAME` is whichever Docker network the api container is on — the fleet
compose's `internal`; the smoke test below uses `pz-test`. `grep`/`sed` are used
rather than node because the fleet host has no node outside the containers.)

## Smoke test (what was verified, 2026-09-29)

Run from `affiliate/` after building the five images with the `:test` tag. Every
line is a complete command (ids come from the seed's JSON, tokens from the api
image); the seed rows are TEST-labelled and the last line removes everything
but the images.

```
docker network create pz-test
docker run -d --name pz-db --network pz-test -e POSTGRES_USER=paparazzi -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=paparazzi postgres:16-alpine
docker run -d --name pz-redis --network pz-test redis:7-alpine
until docker exec pz-db pg_isready -U paparazzi -d paparazzi >/dev/null 2>&1; do sleep 1; done
docker run --rm --network pz-test -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi paparazzi/migrate:test
docker run --rm --network pz-test -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi paparazzi/migrate:test ./node_modules/.bin/tsx db/seed.ts
docker run --rm --network pz-test -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e FLEET_SITES_YAML=/app/config/sites.yaml -e AFFILIATE_WEB_HOST=shop.pz-test.invalid -v "$PWD/../autopub/config:/app/config:ro" paparazzi/migrate:test ./node_modules/.bin/tsx db/seed-fleet.ts --with-demo-programme > seed-fleet.json
ORG_ID=$(grep -m1 '"org_id"' seed-fleet.json | sed 's/.*: "\(.*\)".*/\1/')
WEB_PLACEMENT_ID=$(grep -m1 '"web_placement_id"' seed-fleet.json | sed 's/.*: "\(.*\)".*/\1/')
LOOK_ID=$(grep -m1 '"look_id"' seed-fleet.json | sed 's/.*: "\(.*\)".*/\1/')
WEB_API_TOKEN=$(docker run --rm -e JWT_SECRET=test-secret paparazzi/api:test node scripts/mint-dev-token.mjs --org-id "$ORG_ID" --role publisher_analyst --sub web-shop)
OWNER_TOKEN=$(docker run --rm -e JWT_SECRET=test-secret paparazzi/api:test node scripts/mint-dev-token.mjs --org-id "$ORG_ID" --role publisher_owner --sub fleet-owner)
docker run -d --name pz-api --network pz-test --network-alias api -p 127.0.0.1:3100:3000 -e NODE_ENV=production -e API_HOST=0.0.0.0 -e API_PORT=3000 -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 -e JWT_SECRET=test-secret -e REDIRECT_BASE_URL=http://redirect:3001 paparazzi/api:test
docker run -d --name pz-redirect --network pz-test --network-alias redirect -p 127.0.0.1:3101:3001 -e NODE_ENV=production -e REDIRECT_PORT=3001 -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 paparazzi/redirect:test
docker run -d --name pz-workers --network pz-test -e NODE_ENV=production -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 -e STUB_WEBHOOK_SECRET=test-secret paparazzi/workers:test
docker run -d --name pz-web --network pz-test -p 127.0.0.1:3200:3000 -e API_BASE=http://api:3000 -e WEB_API_TOKEN="$WEB_API_TOKEN" -e WEB_PLACEMENT_ID="$WEB_PLACEMENT_ID" -e NEXT_PUBLIC_SITE_NAME="Paparazzi Commerce" paparazzi/web:test
sleep 5
curl -s http://127.0.0.1:3100/healthz; echo
curl -s http://127.0.0.1:3101/healthz; echo
curl -s http://127.0.0.1:3200/api/healthz; echo
curl -s http://127.0.0.1:3200/ | grep -o '<title>[^<]*</title>\|aria-label="View look: [^"]*"'
docker run --rm --network pz-test -e API_BASE=http://api:3000 -e API_TOKEN="$OWNER_TOKEN" paparazzi/api:test node scripts/mint-links.mjs --placement "$WEB_PLACEMENT_ID"
curl -s "http://127.0.0.1:3200/looks/$LOOK_ID" | grep -o '<a href="http://redirect:3001/r/[0-9a-f]*"[^>]*>[^<]*</a>'
LINK_TOKEN=$(curl -s "http://127.0.0.1:3200/looks/$LOOK_ID" | grep -o 'redirect:3001/r/[0-9a-f]*' | head -1 | sed 's#.*/r/##')
curl -s -o /dev/null -D - "http://127.0.0.1:3101/r/$LINK_TOKEN" | grep -i '^HTTP\|^location'
sleep 8; docker logs pz-workers 2>&1 | grep -o '"message":"[^"]*"' | sort -u
docker rm -f pz-web pz-workers pz-redirect pz-api pz-redis pz-db && docker network rm pz-test && rm -f seed-fleet.json
```

Observed (all containers running as `node`, PID 1):

- migrate: `5 migration(s) applied, 0 already applied`; `--status` lists 0001–0005 applied; `seed.ts` and `seed-fleet.ts --with-demo-programme` succeed, the fleet seed is byte-identical on a second run (5 looks, one per fleet site, `web_placement_id` reported).
- `curl http://127.0.0.1:3100/healthz` → `{"ok":true}` 200; `curl http://127.0.0.1:3101/healthz` → `{"ok":true}` 200; `curl http://127.0.0.1:3200/api/healthz` (proxy) → `{"ok":true}` 200; without a bearer the proxy relays the API's 401 envelope.
- `curl http://127.0.0.1:3200/` → 200, `<title>Paparazzi Commerce</title>`, five cards (`View look: Demo look — Filmybuff`, …), no demo badge.
- mint-links: `minted=1 replayed=0 skipped_linked=4 … failed=0` (one live offer shared by the five looks), url `http://redirect:3001/r/<token>`.
- `curl http://127.0.0.1:3200/looks/<look id>` → 200 with `<a href="http://redirect:3001/r/<token>" rel="sponsored nofollow noopener">View at merchant</a>` and no "Link not available yet".
- `curl -D - http://127.0.0.1:3101/r/<token>` → `HTTP/1.1 302 Found`, `location: https://shop.example.com/p/demo-fleet-sku?subid=<click_id>`, no `set-cookie`; one row in `clicks`.
- workers log: `workers started` (queues click-events, provider-events, feeds, reconciliation, retention), `retention repeat scheduled`, `outbox batch published`, then `click.observed` for that click.

The sandbox that ran this build cannot reach the npm registry without an extra
CA, so the builds were run with `--build-arg NODE_IMAGE=<node:22-alpine plus
that CA>`; nothing else differed from the commands above, and the Dockerfiles
themselves contain no proxy or CA settings.

## Sizes (docker image ls, containerd snapshotter; `node:22-alpine` alone reports 238 MB)

| Image | Size | `--no-cache` build time (sandbox, warm registry) |
|---|---|---|
| `paparazzi/api` | 264 MB | 18 s |
| `paparazzi/redirect` | 270 MB | 15 s |
| `paparazzi/workers` | 255 MB | 14 s |
| `paparazzi/web` | 269 MB | 58 s |
| `paparazzi/migrate` | 262 MB | 4 s |

The service images add 17–32 MB of application code and production
dependencies on top of the base; the migrate image adds pg, yaml and tsx (with
esbuild) and nothing else.
