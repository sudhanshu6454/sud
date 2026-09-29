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
| `paparazzi/web` | `Dockerfile.web` | `@paparazzi/web` (Next.js 14 standalone: the Afflino web app, the shop at `/shop`) | 3000 | `node packages/web/server.js` (`/app`) |
| `paparazzi/migrate` | `Dockerfile.migrate` | `db/migrate.mjs`, `db/seed.ts`, `db/seed-network.ts` (+ `db/network.example.yaml`) | — | `node db/migrate.mjs` (`/app`) |

All five run as the unprivileged `node` user (uid 1000) and listen above port
1024; every copied file is `chown`ed to it, so no image needs a capability and
`cap_drop: [ALL]` + `no-new-privileges` can be set on every service
(`docker-compose.prod.yml` sets neither today).

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
| `PNPM_VERSION` | `9.12.0` | pnpm used by the build stages (api, redirect, workers, web); matches `packageManager`. |
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

One pnpm everywhere: the `PNPM_VERSION` default is 9.12.0, the version
`package.json` pins as `packageManager`, which wrote `pnpm-lock.yaml`
(`lockfileVersion: '9.0'`) and which the CI job uses. The build stages run
`corepack prepare pnpm@${PNPM_VERSION}` with `COREPACK_ENABLE_PROJECT_SPEC=0`,
so the build arg wins over `packageManager` when someone tries another version
(`--build-arg PNPM_VERSION=10.34.6` was verified to accept the lockfile too;
pnpm 10 skips dependency `postinstall` scripts unless allow-listed, and the only
one here is esbuild's optional binary check). When `packageManager` moves,
move the `PNPM_VERSION` default with it.

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
| `NEXT_PUBLIC_SITE_NAME` | Site name in `<title>` (`%s · Afflino`), the footer and the manifest; default `Afflino` (a rename is a restart). |
| `HOSTNAME` / `PORT` | Set to `0.0.0.0` / `3000` in the image. |

## migrate

`db/migrate.mjs`, `db/seed.ts` and `db/seed-network.ts` borrow `pg` and `yaml`
from `../packages/api/node_modules` (relative to `db/`) via `createRequire`. The
image keeps that path: `docker/migrate.package.json` installs `pg 8.23.0`,
`yaml 2.9.1` and `tsx 4.23.15` (the versions resolved in the workspace
`pnpm-lock.yaml`) into `/app/node_modules`, and `/app/packages/api/node_modules`
is a symlink to it. `db/` is copied verbatim, so the TEST example network file
is at `/app/db/network.example.yaml`. Commands (`DATABASE_URL` required,
WORKDIR `/app`):

```
node db/migrate.mjs
node db/migrate.mjs --status
node db/migrate.mjs --baseline
./node_modules/.bin/tsx db/seed.ts
./node_modules/.bin/tsx db/seed-network.ts --with-demo-programme
```

`seed-network.ts` reads `NETWORK_FILE` (unset or empty → the image's
`/app/db/network.example.yaml`; for the operator's own file, mount it, e.g.
`-v "$PWD/network.yaml:/app/config/network.yaml:ro" -e NETWORK_FILE=/app/config/network.yaml`,
or uncomment the volume on the `migrate` service in `docker-compose.prod.yml`)
and `WEB_HOST` (creates the shop's `web` property and, with
`--with-demo-programme`, the placement `network-shop-web` reported as
`web_placement_id`).
`NODE_ENV` is deliberately **not** set in this image: `--with-demo-programme`
seeds TEST-labelled rows and refuses to run under `NODE_ENV=production`. Pass
`-e NODE_ENV=production` to a run when that guard is wanted; under it the seed
also refuses the example network file, so a re-run of the seed against the
operator's own network fails when `NETWORK_FILE` is missing instead of seeding
the five TEST properties into the real organisation
(`docs/runbooks/deploy.md` §1).

## Operator scripts shipped in the api image

`mint-dev-token.mjs` is the dev-grade JWT stub (the API trusts its claims
verbatim until the IdP lands); `mint-links.mjs` mints one tracked link per live
offer for a placement (`--dry-run` to preview). With the network seed's JSON
saved as `seed-network.json` (see the smoke test) and `JWT_SECRET` in the
environment, a read-only token for the shop (the dev stub; `--ttl 365d` so it
outlives the default 8 h, rotated with `JWT_SECRET`), an owner token, and — once
the stack from `docker-compose.prod.yml` is up — the links for the shop's
placement are (`--pull never`: a missing local image fails instead of being
pulled from a registry with `JWT_SECRET` handed to it; `IMAGE_TAG` as set for
the deploy):

```
WEB_API_TOKEN=$(docker run --rm --pull never -e JWT_SECRET "paparazzi/api:${IMAGE_TAG:-latest}" node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_analyst --sub web-shop --ttl 365d)
OWNER_TOKEN=$(docker run --rm --pull never -e JWT_SECRET "paparazzi/api:${IMAGE_TAG:-latest}" node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_owner --sub network-owner)
docker compose -f docker-compose.prod.yml run --rm --no-deps -e API_BASE=http://api:3000 -e API_TOKEN="$OWNER_TOKEN" api node scripts/mint-links.mjs --placement "$(grep -m1 '"web_placement_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')"
```

(`run --no-deps api` starts a one-off container from the api image on the
compose network, so `http://api:3000` is the running api service; the smoke test
below does the same with plain `docker run --network pz-test`. `grep`/`sed` read
the JSON so the host needs no node outside the containers.)

## Smoke test (what was verified, 2026-09-29; re-run with the network seed)

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
docker run --rm --network pz-test -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e WEB_HOST=shop.pz-test.invalid paparazzi/migrate:test ./node_modules/.bin/tsx db/seed-network.ts --with-demo-programme > seed-network.json
ORG_ID=$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')
WEB_PLACEMENT_ID=$(grep -m1 '"web_placement_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')
LOOK_ID=$(grep -m1 '"look_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')
WEB_API_TOKEN=$(docker run --rm -e JWT_SECRET=test-secret paparazzi/api:test node scripts/mint-dev-token.mjs --org-id "$ORG_ID" --role publisher_analyst --sub web-shop)
OWNER_TOKEN=$(docker run --rm -e JWT_SECRET=test-secret paparazzi/api:test node scripts/mint-dev-token.mjs --org-id "$ORG_ID" --role publisher_owner --sub network-owner)
docker run -d --name pz-api --network pz-test --network-alias api -p 127.0.0.1:3100:3000 -e NODE_ENV=production -e API_HOST=0.0.0.0 -e API_PORT=3000 -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 -e JWT_SECRET=test-secret -e REDIRECT_BASE_URL=http://redirect:3001 paparazzi/api:test
docker run -d --name pz-redirect --network pz-test --network-alias redirect -p 127.0.0.1:3101:3001 -e NODE_ENV=production -e REDIRECT_PORT=3001 -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 paparazzi/redirect:test
docker run -d --name pz-workers --network pz-test -e NODE_ENV=production -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 -e STUB_WEBHOOK_SECRET=test-secret paparazzi/workers:test
docker run -d --name pz-web --network pz-test -p 127.0.0.1:3200:3000 -e API_BASE=http://api:3000 -e WEB_API_TOKEN="$WEB_API_TOKEN" -e WEB_PLACEMENT_ID="$WEB_PLACEMENT_ID" -e NEXT_PUBLIC_SITE_NAME=Afflino paparazzi/web:test
sleep 5
curl -s http://127.0.0.1:3100/healthz; echo
curl -s http://127.0.0.1:3101/healthz; echo
curl -s http://127.0.0.1:3200/api/healthz; echo
curl -s http://127.0.0.1:3200/ | grep -o '<title>[^<]*</title>'
curl -s http://127.0.0.1:3200/shop | grep -o '<title>[^<]*</title>\|<h2 class="LookCard_title[^"]*">[^<]*</h2>\|Demo data[^<]*'
docker run --rm --network pz-test -e API_BASE=http://api:3000 -e API_TOKEN="$OWNER_TOKEN" paparazzi/api:test node scripts/mint-links.mjs --placement "$WEB_PLACEMENT_ID"
curl -s "http://127.0.0.1:3200/looks/$LOOK_ID" | grep -o '<title>[^<]*</title>\|<a href="http://redirect:3001/r/[0-9a-f]*" rel="[^"]*"\|Link not available yet\|Demo data[^<]*'
LINK_TOKEN=$(curl -s "http://127.0.0.1:3200/looks/$LOOK_ID" | grep -o 'redirect:3001/r/[0-9a-f]*' | head -1 | sed 's#.*/r/##')
curl -s -o /dev/null -D - "http://127.0.0.1:3101/r/$LINK_TOKEN" | grep -i '^HTTP\|^location\|^set-cookie'
docker exec pz-db psql -U paparazzi -d paparazzi -tAc "select count(*) from clicks"
sleep 8; docker logs pz-workers 2>&1 | grep -o '"message":"[^"]*"' | sort -u
docker rm -f pz-web pz-workers pz-redirect pz-api pz-redis pz-db && docker network rm pz-test && rm -f seed-network.json
```

Observed on the last run (2026-09-29, re-run verbatim after the switch to
the network seed and again after the review fixes, with `paparazzi/migrate:test`
(262 MB) and `paparazzi/api:test` (264 MB) rebuilt from this tree,
`paparazzi/web:test` (273 MB) rebuilt with every layer cached (no input
changed), and the redirect and workers images of the same day — their code did
not change; all containers running as `node`, PID 1). On that stack, with the
api forwarded to `localhost:3000`, the kill-switch drill lines of
`docs/runbooks/deploy.md` §4 ran as written: pause 200 `paused` (the link then
served the paused page, 200), resume 200 `active` (302 again), `editor` pause
403, and `audit_log` rows `programme.pause` / `programme.resume` naming the
seeded `network_admin` user:

- migrate: `5 migration(s) applied, 0 already applied`; `seed.ts` succeeds and `seed-network.ts --with-demo-programme` reads the example file shipped in the image (`seed-network: 5 properties from /app/db/network.example.yaml, shop host shop.pz-test.invalid, with TEST demo programme`). Not repeated inside the image here (checked the same day on a fresh Postgres 16 outside Docker): a second run gives identical row counts and byte-identical JSON.
- `curl http://127.0.0.1:3100/healthz` → `{"ok":true}`; `curl http://127.0.0.1:3101/healthz` → `{"ok":true}`; `curl http://127.0.0.1:3200/api/healthz` (proxy) → `{"ok":true}`.
- `curl http://127.0.0.1:3200/` → `<title>Afflino</title>` (the marketing home); `curl http://127.0.0.1:3200/shop` → `<title>Shop the looks · Afflino</title>` and five `<h2 class="LookCard_title__…">` cells, one per entry of the network file (`Demo look — Demo Instagram`, `— Demo YouTube`, `— Demo Snapchat`, `— Demo Telegram`, `— Demo Web`; order varies with publish time), no "Demo data" badge (live).
- mint-links: `summary: looks=5 items=5 minted=1 replayed=0 skipped_linked=4 skipped_no_offer=0 skipped_duplicate_offer=0 failed=0` (one live offer shared by the five looks), url `http://redirect:3001/r/<token>`.
- `curl http://127.0.0.1:3200/looks/<look id>` (the first property's look) → `<title>Demo look — Demo Instagram · Afflino</title>` and `<a href="http://redirect:3001/r/<token>" rel="sponsored nofollow noopener"` (the "View at merchant →" CTA), no "Link not available yet", no demo badge.
- `curl -D - http://127.0.0.1:3101/r/<token>` → `HTTP/1.1 302 Found`, `location: https://shop.example.com/p/demo-network-sku?subid=<click_id>`, no `set-cookie` line; `select count(*) from clicks` → `1`.
- workers log: `workers started`, `outbox relay started`, `retention repeat scheduled`, `outbox batch published`, then `click.observed` for that click.

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
| `paparazzi/web` | 273 MB (269 MB before the Afflino rebuild) | 58 s (`--no-cache`, before the rebuild); the Afflino rebuild took 84 s with only the base and corepack layers cached (install 9 s, `next build` 71 s) |
| `paparazzi/migrate` | 262 MB | 4 s |

The service images add 17–32 MB of application code and production
dependencies on top of the base; the migrate image adds pg, yaml and tsx (with
esbuild) and nothing else.
