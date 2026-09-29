# docker/ — the five Paparazzi images and the edge

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

The sixth container is the **edge**: the stock `caddy:2-alpine` image with
[`Caddyfile`](Caddyfile) mounted read-only — no image is built for it. It is
the only service that publishes on all interfaces (see "The edge" below).

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
| `SITE_URL` | Public origin for canonical URLs, og:url, robots.txt and the sitemap; default `https://afflino.com` (compose: `https://${SITE_HOST:-afflino.com}`). |
| `SITE_INDEXING` | `on` opens the site to search engines; anything else (compose default `off`) = pre-launch: robots.txt `Disallow: /`, empty sitemap, noindex on every page. |
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
the six TEST properties into the real organisation
(`docs/runbooks/deploy.md` §1).

## Operator scripts shipped in the api image

`mint-dev-token.mjs` is the dev-grade JWT stub (the API trusts its claims
verbatim until the IdP lands); `mint-links.mjs` mints one tracked link per live
offer for a placement (`--dry-run` to preview). The Amazon.in Associates
operator CLI ships compiled, `node dist/cli/amazon.js setup | offers |
template | links | import-report | status | pause | resume`
(`packages/api/src/cli/amazon.ts`); on the Linode it is driven by
`deploy/linode/amazon.sh` (`docs/runbooks/deploy.md` §1A). With the network seed's JSON
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
docker compose -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T -e API_BASE=http://api:3000 -e API_TOKEN="$OWNER_TOKEN" api node scripts/mint-links.mjs --placement "$(grep -m1 '"web_placement_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')"
```

(With managed databases, drop `-f docker-compose.single-host.yml`.)

(`run --no-deps api` starts a one-off container from the api image on the
compose network, so `http://api:3000` is the running api service; the smoke test
below does the same with plain `docker run --network pz-test`. `grep`/`sed` read
the JSON so the host needs no node outside the containers.)

## The edge (`docker/Caddyfile`)

`docker-compose.prod.yml` runs `caddy:2-alpine` as the `edge` service with
`./docker/Caddyfile` mounted at `/etc/caddy/Caddyfile` and the volumes
`caddy_data` (certificates, ACME account) and `caddy_config`, with **host
networking** (`network_mode: host`): Caddy itself listens on the server's
80/tcp, 443/tcp and 443/udp (HTTP/3), IPv4 and IPv6, and reaches redirect
and web on their 127.0.0.1 ports; api (3000), redirect (3001) and web (3002)
publish on 127.0.0.1 only. Its admin API is off (with host networking it
would listen on the server's localhost:2019; a changed Caddyfile is applied
by restarting the edge, which the Linode installer does). Environment (set
by compose):

| Var | Compose value | Meaning |
|---|---|---|
| `SITE_HOST` | `${SITE_HOST:-afflino.com}` | the apex host; `www.<SITE_HOST>` redirects to it |
| `ACME_EMAIL` | `${ACME_EMAIL:-}` | optional ACME account email; empty = none |
| `EDGE_ADDRESS` | `<SITE_HOST>, www.<SITE_HOST>` | the site address: HTTPS with automatic certificates for exactly those two names; `docker-compose.edge-test.yml` sets `:8088` (plain HTTP, any Host, no certificates) |
| `EDGE_BIND` | unset | test mode only: `docker-compose.edge-test.yml` sets `bind 127.0.0.1`, so the test edge listens on 127.0.0.1:8088 and nowhere else; unset = every interface |
| `REDIRECT_UPSTREAM` | `127.0.0.1:3001` | the click service; the Caddyfile's default `redirect:3001` serves an edge on the compose network (the smoke test below) |
| `WEB_UPSTREAM` | `127.0.0.1:3002` | the web app; default `web:3000` |

Routes: `www.<SITE_HOST>/<path>?<query>` → `301` to
`https://<SITE_HOST>/<path>?<query>`; `/r/*` → the redirect; everything
else → the web (the web serves `/api/*` as its same-origin proxy to the
API, so provider webhooks and payout callbacks are
`https://<SITE_HOST>/api/v1/...`; request bodies above 4 MB are refused at
the edge with 413). Every response of the site, the edge's own errors
included (a 502 while an upstream is down or restarting, the 413, a
`CONNECT`: the `security_headers` snippet is imported in the site and in
its `handle_errors`, which answers `<status> <text>` as plain text):
`Strict-Transport-Security: max-age=31536000` (no includeSubDomains, no
preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY`; `Server`, `Via`
and `X-Powered-By` removed. The one response without them is Caddy's own
HTTP → HTTPS `308` on port 80 in production (outside the site block; it
carries `Server: Caddy`, and browsers ignore HSTS over plain HTTP). No Content-Security-Policy yet (open item,
`docs/threat-model.md` §4.7). Caddy trusts no client (`trusted_proxies` is not
set), so it replaces any client-supplied `X-Forwarded-For` with the address
it saw; `X-Real-IP` is overwritten with the same address and `Forwarded` is
removed. api and redirect run with `TRUST_PROXY=loopback,uniquelocal`, so the
redirect hashes the address the edge saw and nothing a shopper sends. No
access log is configured; the default log (startup, certificates, errors)
drops `remote_ip`, `remote_port`, `client_ip` and the request headers
(checked 2026-09-29: with no upstream, a request carrying a spoofed
`X-Forwarded-For` and a marker user-agent gave a 502 whose error entry holds
only `proto`, `method`, `host` and `uri` — no address, no header).

Client addresses and Docker: a connection Docker forwards through its
userland proxy reaches the container from the compose network's gateway
address, not from the client — the case for host-local curls to a published
port and for IPv6 clients on an IPv4-only compose network. That is why the
production edge uses host networking: Caddy owns the server's sockets and
sees every client's own address, IPv4 and IPv6, so afflino.com can have an
AAAA record. The redirect and api then see the edge (via their 127.0.0.1
ports) from the gateway address, a private peer `TRUST_PROXY` trusts, and
take the client's address from the `X-Forwarded-For` Caddy wrote. The smoke
test below still runs the edge on its own network (`pz-test`, published
127.0.0.1:8088), so there the stored hash is the gateway's; the Linode
installer's rehearsal (`deploy/linode/README.md`) used the host-networked
edge and stored HMAC(key, 127.0.0.1), the address the edge really saw.

## Smoke test (what was verified, 2026-09-29; re-run with the edge)

Run from `affiliate/` after building the five images with the `:test` tag
(`caddy:2-alpine`, `postgres:16-alpine` and `redis:7-alpine` are pulled if
absent). Every line is a complete command (ids come from the seed's JSON,
tokens from the api image); the seed rows are TEST-labelled, the secrets are
TEST values, and the last line removes everything but the images. The edge
runs in its plain-HTTP test mode on 127.0.0.1:8088 with the same Caddyfile as
production, so the checks send `Host: afflino.com` / `Host: www.afflino.com`.

```
docker network create pz-test
docker run -d --name pz-db --network pz-test -e POSTGRES_USER=paparazzi -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=paparazzi postgres:16-alpine
docker run -d --name pz-redis --network pz-test redis:7-alpine
until docker exec pz-db pg_isready -U paparazzi -d paparazzi >/dev/null 2>&1; do sleep 1; done
docker run --rm --network pz-test -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi paparazzi/migrate:test
docker run --rm --network pz-test -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi paparazzi/migrate:test ./node_modules/.bin/tsx db/seed.ts
docker run --rm --network pz-test -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e WEB_HOST=afflino.com paparazzi/migrate:test ./node_modules/.bin/tsx db/seed-network.ts --with-demo-programme > seed-network.json
ORG_ID=$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')
WEB_PLACEMENT_ID=$(grep -m1 '"web_placement_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')
LOOK_ID=$(grep -m1 '"look_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')
WEB_API_TOKEN=$(docker run --rm -e JWT_SECRET=test-secret paparazzi/api:test node scripts/mint-dev-token.mjs --org-id "$ORG_ID" --role publisher_analyst --sub web-shop)
OWNER_TOKEN=$(docker run --rm -e JWT_SECRET=test-secret paparazzi/api:test node scripts/mint-dev-token.mjs --org-id "$ORG_ID" --role publisher_owner --sub network-owner)
docker run -d --name pz-api --network pz-test --network-alias api -p 127.0.0.1:3100:3000 -e NODE_ENV=production -e API_HOST=0.0.0.0 -e API_PORT=3000 -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 -e JWT_SECRET=test-secret -e REDIRECT_BASE_URL=https://afflino.com -e TRUST_PROXY=loopback,uniquelocal paparazzi/api:test
docker run -d --name pz-redirect --network pz-test --network-alias redirect -p 127.0.0.1:3101:3001 -e NODE_ENV=production -e REDIRECT_PORT=3001 -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 -e TRUST_PROXY=loopback,uniquelocal -e IP_HASH_KEY=test-ip-hash-key-0123456789abcdef paparazzi/redirect:test
docker run -d --name pz-workers --network pz-test -e NODE_ENV=production -e DATABASE_URL=postgresql://paparazzi:pw@pz-db:5432/paparazzi -e REDIS_URL=redis://pz-redis:6379 -e STUB_WEBHOOK_SECRET=test-secret paparazzi/workers:test
docker run -d --name pz-web --network pz-test --network-alias web -p 127.0.0.1:3200:3000 -e API_BASE=http://api:3000 -e WEB_API_TOKEN="$WEB_API_TOKEN" -e WEB_PLACEMENT_ID="$WEB_PLACEMENT_ID" -e NEXT_PUBLIC_SITE_NAME=Afflino -e SITE_URL=https://afflino.com -e SITE_INDEXING=off paparazzi/web:test
docker run -d --name pz-edge --network pz-test -p 127.0.0.1:8088:8088 -e SITE_HOST=afflino.com -e ACME_EMAIL= -e EDGE_ADDRESS=:8088 -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine
sleep 5
curl -s http://127.0.0.1:3100/healthz; echo
curl -s http://127.0.0.1:3101/healthz; echo
curl -s http://127.0.0.1:3200/api/healthz; echo
curl -s -H 'Host: afflino.com' http://127.0.0.1:8088/api/healthz; echo
curl -s -H 'Host: afflino.com' http://127.0.0.1:8088/ | grep -o '<title>[^<]*</title>\|<link rel="canonical" href="[^"]*"/>\|<meta property="og:url" content="[^"]*"/>\|<meta name="robots" content="[^"]*"/>'
curl -s -D - -o /dev/null -H 'Host: afflino.com' http://127.0.0.1:8088/ | grep -i '^HTTP\|^strict-transport\|^x-content-type\|^referrer-policy\|^x-frame\|^server\|^via\|^x-powered-by'
curl -s -H 'Host: afflino.com' http://127.0.0.1:8088/robots.txt
curl -s -H 'Host: afflino.com' http://127.0.0.1:8088/sitemap.xml; echo
curl -s -D - -o /dev/null -H 'Host: www.afflino.com' 'http://127.0.0.1:8088/shop?utm_source=smoke&x=1' | grep -i '^HTTP\|^location'
curl -s -H 'Host: afflino.com' http://127.0.0.1:8088/shop | grep -o '<title>[^<]*</title>\|<h2 class="LookCard_title[^"]*">[^<]*</h2>\|Demo data[^<]*'
docker run --rm --network pz-test -e API_BASE=http://api:3000 -e API_TOKEN="$OWNER_TOKEN" paparazzi/api:test node scripts/mint-links.mjs --placement "$WEB_PLACEMENT_ID"
curl -s -H 'Host: afflino.com' "http://127.0.0.1:8088/looks/$LOOK_ID" | grep -o '<title>[^<]*</title>\|<a href="https://afflino.com/r/[0-9a-f]*" rel="[^"]*"\|Link not available yet\|Demo data[^<]*'
LINK_TOKEN=$(curl -s -H 'Host: afflino.com' "http://127.0.0.1:8088/looks/$LOOK_ID" | grep -o 'https://afflino.com/r/[0-9a-f]*' | head -1 | sed 's#.*/r/##')
curl -s -o /dev/null -D - -H 'Host: afflino.com' -H 'X-Forwarded-For: 203.0.113.99' -H 'X-Real-IP: 203.0.113.99' -H 'Forwarded: for=203.0.113.99' "http://127.0.0.1:8088/r/$LINK_TOKEN" | grep -i '^HTTP\|^location\|^set-cookie\|^strict-transport'
docker exec pz-db psql -U paparazzi -d paparazzi -tAc "select count(*) from clicks"
python3 -c 'import hmac,hashlib,sys; k,h,peer,spoof=sys.argv[1:]; f=lambda ip: hmac.new(k.encode(),ip.encode(),hashlib.sha256).hexdigest(); print("ip_hash is HMAC(edge peer %s): %s; is HMAC(spoofed %s): %s; is plain sha256(peer): %s" % (peer, h==f(peer), spoof, h==f(spoof), h==hashlib.sha256(peer.encode()).hexdigest()))' test-ip-hash-key-0123456789abcdef "$(docker exec pz-db psql -U paparazzi -d paparazzi -tAc "select context->>'ip_hash' from clicks order by occurred_at desc limit 1")" "$(docker network inspect pz-test -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')" 203.0.113.99
docker logs pz-edge 2>&1 | grep -c "$(docker network inspect pz-test -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')\|203.0.113.99"
head -c 5000000 /dev/zero | curl -s -D - -o /dev/null -H 'Host: afflino.com' --data-binary @- http://127.0.0.1:8088/api/v1/looks | grep -i '^HTTP/1.1 4\|^strict-transport\|^x-frame\|^server'
docker stop pz-web
curl -s -D - -H 'Host: afflino.com' http://127.0.0.1:8088/ | grep -i '^HTTP\|^strict-transport\|^x-content-type\|^referrer-policy\|^x-frame\|^server\|^via\|^502'
docker start pz-web
sleep 8; docker logs pz-workers 2>&1 | grep -o '"message":"[^"]*"' | sort -u
docker rm -f -v pz-edge pz-web pz-workers pz-redirect pz-api pz-redis pz-db && docker network rm pz-test && rm -f seed-network.json
```

Observed on the last run (2026-09-29, verbatim, all five `:test` images
rebuilt from this tree — last after the review fixes of the Amazon.in
Associates integration (migration 0006 without the sub-tag / third-party
columns, the import lock, the operator's returns step, the privacy gate);
`caddy:2-alpine` = Caddy v2.11.4; every observed line below unchanged). The TEST programme here is not an Amazon one, so the shop
and the redirect answer exactly as before; the Amazon path (the tag, no
`subid`, "Buy on Amazon.in", the report import) is rehearsed on the
installer's stack (`deploy/linode/README.md` "What was checked"):

- migrate: `6 migration(s) applied, 0 already applied`; `seed.ts` succeeds;
  `seed-network: 6 properties from /app/db/network.example.yaml, shop host afflino.com, with TEST demo programme`.
- `/healthz` on 3100 (api) and 3101 (redirect), `/api/healthz` on 3200 (web
  proxy) and through the edge → `{"ok":true}` each.
- Edge `/` (`Host: afflino.com`) → `<title>Afflino</title>`,
  `<meta name="robots" content="noindex, nofollow"/>` (SITE_INDEXING=off),
  `<link rel="canonical" href="https://afflino.com"/>`,
  `<meta property="og:url" content="https://afflino.com"/>`; headers
  `HTTP/1.1 200 OK`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Strict-Transport-Security: max-age=31536000`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and no
  `Server`, `Via` or `X-Powered-By` line.
- `/robots.txt` → `User-Agent: *` / `Disallow: /` (no Sitemap line);
  `/sitemap.xml` → an empty `<urlset>`.
- `Host: www.afflino.com`, `/shop?utm_source=smoke&x=1` →
  `HTTP/1.1 301 Moved Permanently`,
  `Location: https://afflino.com/shop?utm_source=smoke&x=1`.
- `/shop` → `<title>Shop the looks · Afflino</title>` and the six TEST
  network looks (`Demo look — Demo Instagram` / Facebook / YouTube /
  Snapchat / Telegram / Web), no "Demo data" badge (live).
- mint-links: `summary: looks=6 items=6 minted=1 replayed=0 skipped_linked=5 skipped_no_offer=0 skipped_duplicate_offer=0 failed=0`, url `https://afflino.com/r/<token>`.
- Look page → `<title>Demo look — Demo Instagram · Afflino</title>` and
  `<a href="https://afflino.com/r/<token>" rel="sponsored nofollow noopener"`.
- `GET /r/<token>` through the edge with `X-Forwarded-For`, `X-Real-IP` and
  `Forwarded` all claiming 203.0.113.99 → `HTTP/1.1 302 Found`,
  `Location: https://shop.example.com/p/demo-network-sku?subid=<click_id>`,
  HSTS, no `set-cookie`; `select count(*) from clicks` → `1`;
  `ip_hash is HMAC(edge peer 172.18.0.1): True; is HMAC(spoofed 203.0.113.99): False; is plain sha256(peer): False`
  (the edge peer is the network gateway, see "The edge").
- Edge log lines naming the peer or the spoofed address: `0`.
- A 5 MB body → `HTTP/1.1 413 Request Entity Too Large` with HSTS and
  `X-Frame-Options: DENY` (after curl's `100 Continue`); with `pz-web`
  stopped, `/` → `HTTP/1.1 502 Bad Gateway` with a `502 Bad Gateway` body,
  HSTS, nosniff, Referrer-Policy and DENY, and no `Server` or `Via` line
  (re-run 2026-09-29 after the `handle_errors` change; before it the 502
  carried `Server: Caddy` and no security header).
- workers log: `workers started`, `outbox relay started`, `retention repeat
  scheduled`, `amazon refresh repeat scheduled` (the hourly Amazon price job;
  it does nothing without an Amazon programme), `outbox batch published`,
  `click.observed`.
- The last line removed the seven containers with their anonymous volumes (`-v`: the Postgres, Redis and Caddy images declare volumes; before 2026-09-29 the line left them behind) and the network.

The sandbox that ran this build cannot reach the npm registry without an extra
CA, so the builds were run with `--build-arg NODE_IMAGE=<node:22-alpine plus
that CA>`; nothing else differed from the commands above, and the Dockerfiles
themselves contain no proxy or CA settings.

## Compose rehearsal (prod + single-host + edge in plain-HTTP mode)

The same stack as the Linode, with the edge on 127.0.0.1:8088 instead of
80/443 (`docker-compose.edge-test.yml`), under a throwaway project name. See
`docs/runbooks/deploy.md` §1R for the commands and what was observed, and
`deploy/linode/README.md` for the installer run the same way.

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
esbuild) and nothing else. The 2026-09-29 rebuild for the edge (trust proxy,
keyed ip hash, indexing gate) left every size unchanged (cached layers, not
`--no-cache`). The edge's `caddy:2-alpine` reports 88.8 MB.
