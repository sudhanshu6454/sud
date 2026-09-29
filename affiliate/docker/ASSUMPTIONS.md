# docker/ — assumptions and decisions

## 2026-09-29 — images that build and boot

1. **Base + package manager.** `node:22-alpine` for every stage; pnpm 9.12.0
   via corepack, the same version `package.json` pins as `packageManager`,
   which wrote `pnpm-lock.yaml` and which CI uses. `COREPACK_ENABLE_PROJECT_SPEC=0`
   makes corepack honour the `PNPM_VERSION` build arg, so another version can be
   tried without a Dockerfile edit (10.34.6 was also verified to accept the
   lockfile under `--frozen-lockfile`). `PNPM_VERSION` and `NODE_IMAGE` are
   build args so neither is hard-wired.
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
   so `seed-network.ts --with-demo-programme` can run; the guard is the script's,
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
   `migrate` service passes `NETWORK_FILE` and `WEB_HOST` to `seed-network.ts`
   (unset `NETWORK_FILE` → the image's `db/network.example.yaml`; a commented
   volume mounts the operator's own file). Port publishing is unchanged (3000,
   3001, 3002 on all interfaces — the LB/private network fronts them).
8. **Sandbox caveat.** The builds were verified with `NODE_IMAGE` pointing at a
   local `node:22-alpine` derivative carrying the sandbox's egress CA (the only
   way to reach the npm registry from inside a build here). The Dockerfiles
   contain no proxy or CA settings; the `:test` images built in the sandbox
   carry a `NODE_EXTRA_CA_CERTS` env from that base and must not be shipped.

## 2026-09-29 (review fixes)

9. **Nested env files stay out of every image.** `.dockerignore` excludes `**/.env` and
   `**/.env.*` as well as the root ones; a probe build confirmed a `packages/web/.env.local`
   no longer enters the context while `.env.example` still does.
10. **Redis stays on a private network** (superseded as a compose setting by 11). The
    shared-host compose file this item described put Postgres, Redis, migrate and workers on a
    private bridge, with only api, redirect and web on the proxy's network, so no other
    container on that host could reach Redis, whose `route:{token}` entries the redirector
    trusts. The rule carries over to any deployment: Redis has no password on a private
    network; add `--requirepass` and a password in `REDIS_URL` if anything else ever joins it.

## 2026-09-29 — standalone app

11. **Standalone since 2026-09-29** (history, not instructions). The
    Dockerfiles' build steps are unchanged (only comments changed): the migrate image ships
    `db/seed-network.ts` and `db/network.example.yaml` (`db/` is copied whole), the
    `migrate` service in `docker-compose.prod.yml` takes `NETWORK_FILE` and `WEB_HOST`
    instead of a mounted site list, and the only compose files are this directory's
    `docker-compose.yml` (dev Postgres + Redis) and `docker-compose.prod.yml`.

## 2026-09-29 — the edge and the single-host shape (afflino.com on a Linode)

12. **The edge is the stock `caddy:2-alpine`**, not a built image: `docker/Caddyfile` is mounted
    read-only, certificates live in the `caddy_data` volume. It is the only service listening on
    all interfaces (80, 443/tcp, 443/udp; host networking since 2026-09-29, item 19); api,
    redirect and web publish on 127.0.0.1 (Docker's published ports bypass ufw). The image tag floats within Caddy 2 (the brief named
    `caddy:2-alpine`); pin a minor (`caddy:2.11-alpine`) if a Caddy update ever needs holding
    back. Verified with Caddy v2.11.4.
13. **Certificates only for `SITE_HOST` and `www.SITE_HOST`**: the site address is exactly those
    two names (no on-demand TLS, no catch-all), so a request for any other name or a bare IP gets
    no certificate (TLS handshake refused, checked with Caddy's internal CA). `ACME_EMAIL` is
    optional (`email ""` in the Caddyfile = an ACME account without an email).
14. **Plain-HTTP test mode** is a separate override (`docker-compose.edge-test.yml`,
    `EDGE_ADDRESS=:8088`, `EDGE_BIND=bind 127.0.0.1`: Caddy listens on 127.0.0.1:8088 and
    nothing else) rather than variables on the production file, so the production listeners
    cannot be half-switched by a stray variable. (Before host networking it overrode the
    published ports with `!override`, which needed Docker Compose 2.24.4; no longer.)
    `EDGE_BIND` carries the whole directive because Caddy has no "bind to the default" value:
    unset, the line is empty and Caddy binds every interface.
15. **X-Forwarded-For is Caddy's own** (it trusts no client, since `trusted_proxies` is unset, and
    replaces the header); an explicit `header_up X-Forwarded-For` would only add an
    "Unnecessary header_up" warning at every start. `X-Real-IP` is overwritten and `Forwarded`
    removed explicitly. Proven end to end by the spoofed-header check in README.md's smoke test.
16. **Docker's userland proxy hides client addresses** for connections it forwards (host-local
    curls, IPv6 clients on an IPv4-only compose network): a container behind a published port
    then sees the network gateway. Resolved for the edge by item 19 (host networking), which is
    what makes the AAAA record safe; still true of the smoke test's bridge-networked edge.
17. **Single host**: `docker-compose.single-host.yml` adds `postgres:16-alpine` and
    `redis:7-alpine` (append-only), named volumes, no published ports, healthchecks, and points
    `DATABASE_URL` / `REDIS_URL` at them; `docker-compose.prod.yml` therefore interpolates
    `DATABASE_URL` / `REDIS_URL` with `:-` (compose checks each file on its own, so a `:?` there
    would fire even when the override supplies the value). An empty value is still loud: migrate
    exits, and api / redirect / workers refuse to boot under `NODE_ENV=production` without
    `REDIS_URL`. The project name is fixed (`name: afflino`), so volumes are `afflino_pgdata`,
    `afflino_redisdata`, `afflino_caddy_data`, `afflino_caddy_config` wherever the checkout is.
18. **Not set yet**: `cap_drop: [ALL]` / `no-new-privileges` on
    the node services, a CSP, rate limiting at the edge.
19. **The edge uses host networking** (2026-09-29, with the Linode installer). Chosen over
    enabling IPv6 on the compose network, which would need a ULA subnet, ip6tables NAT and IPv6
    forwarding on the host (forwarding stops the kernel from accepting router advertisements,
    and the Linode's IPv6 is SLAAC-configured): with host networking there is no NAT or proxy in
    front of Caddy at all, ufw's rules apply to it, and nothing changes on the host's network
    configuration. Costs: the edge reaches redirect and web through their 127.0.0.1 published
    ports (Docker's proxy for loopback connections, one extra local hop per new upstream
    connection; Caddy keeps upstream connections alive), and Caddy's admin API would have been
    on the server's localhost, so it is off. Verified in the sandbox (IPv4 only; the sandbox
    kernel has no IPv6): a spoofed click through the host-networked edge stored HMAC(key,
    127.0.0.1), the address Caddy saw, not the gateway's. IPv6 behaviour follows from Caddy
    owning the socket; it is not tested here.
20. **Builds run with `BUILDX_NO_DEFAULT_ATTESTATIONS=1` in the Linode installer.** On Docker's
    containerd image store (the default of a fresh Docker 29 install; this sandbox too) a
    default build adds a provenance attestation that differs on every build, so an image built
    from unchanged, fully cached layers still got a new id and compose recreated every service on
    each `up -d --build` (observed in the sandbox: all five image ids changed, api / redirect /
    workers / web recreated, with identical image configs). Without the attestation, a re-run on
    an unchanged checkout keeps the same image ids and recreates nothing (checked). Running
    compose by hand without the variable still works; it only recreates the services.

