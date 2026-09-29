# Paparazzi Affiliate Commerce Platform

Paparazzi/entertainment content → attributable affiliate purchases.
India-first, INR. The platform owns discovery, attribution, and the publisher
ledger; merchants own checkout.

> Foundation scaffold (weeks 3–6 core product). No real merchant credentials,
> no production secrets, no real money movement.

## Running Afflino

**What it is.** Afflino is a standalone website and app: an India-first
affiliate network with a marketing site, onboarding, creator / brand /
agency / admin areas and a consumer shop at `/shop`, on top of this
platform's API, click redirect, workers and Postgres ledger. It runs from
this directory alone — its own dev stack (`docker-compose.yml`: Postgres 16 +
Redis 7), production stack (`docker-compose.prod.yml`), images (`docker/`) and
CI workflow (`.github/workflows/afflino.yml` at the repository root, run on
changes under `affiliate/`).

**The in-house publisher network.** Afflino runs its own publisher network
beside the creators and publishers who sign up through `/join`.
`db/seed-network.ts` registers it from a **network file** (YAML; per property
`key`, `name` (at most 80 characters), `platform` = `instagram` | `youtube` |
`snapchat` | `telegram` | `web`, `account` = handle or hostname, `url`). The default,
[`db/network.example.yaml`](db/network.example.yaml), is TEST data only (five
"Demo …" properties on reserved `example.com` names); `--network <path>` or
`NETWORK_FILE` points the seed at the operator's own file. What it creates
(idempotent, one transaction):

| Input | Platform rows |
|---|---|
| — | organisation `afflino` ("Afflino"); publisher "Afflino in-house network", `approved` / `active` — it skips the onboarding state machine because it *is* the operator ([`scripts/ASSUMPTIONS.md`](scripts/ASSUMPTIONS.md) §11) |
| each network-file entry | one property (`platform`, `account` as `external_account_id`, `url` as canonical URL; `approved`, `owner_operated` verification); with `--with-demo-programme` one placement `network-<key>-<channel>` and one published TEST look "Demo look — <name>" |
| `WEB_HOST` / `--web-host` (the shop's host) | the shop's own `web` property and, with `--with-demo-programme`, the placement `network-shop-web` (channel `shop_web`); its id is printed as `web_placement_id` and becomes `WEB_PLACEMENT_ID` |
| `SEED_OWNER_EMAIL` / `SEED_OPERATOR_EMAIL` / `SEED_APPROVER_EMAIL` / `SEED_ADMIN_EMAIL` | the `publisher_owner`, `finance_operator`, `finance_approver`, `network_admin` logins; `<role>@afflino.invalid` (RFC 2606) until set |

Only the rows behind `--with-demo-programme` are TEST data ("Demo Merchant
(network sandbox)", "Demo Network Programme", `shop.example.com`, one offer at
149900 minor); **no real merchant programme exists** — those are human-gated
in [`docs/action-tracker.md`](docs/action-tracker.md). Under
`NODE_ENV=production` the seed refuses the flag and the example network file.
Re-runs never lift a suspension, pause, revocation or withdrawal, and the
seed refuses (rolling back) to take over a property or placement another
organisation owns ([`db/README.md`](db/README.md) "Network
seed", including the network file's validation rules).

**Local development**, from this directory (Node 22, pnpm 9.12.0, Docker):

```sh
pnpm install --frozen-lockfile
docker compose up -d postgres redis
cp .env.example .env
set -a; . ./.env; set +a
node db/migrate.mjs
./packages/api/node_modules/.bin/tsx db/seed.ts
WEB_HOST=shop.example.com ./packages/api/node_modules/.bin/tsx db/seed-network.ts --with-demo-programme
```

(`seed.ts` adds the separate TEST demo organisation — the same graph the
money-loop demo seeds into its own database; `seed-network.ts` prints its
JSON summary on stdout.) Then the dev servers,
one terminal each with the same `.env` loaded — the API on 3000, the
redirect on 3001 and the web on its own port, 3002, so it does not collide
with the API:

```sh
pnpm --filter @paparazzi/api dev
pnpm --filter @paparazzi/redirect dev
pnpm --filter @paparazzi/workers dev
PORT=3002 pnpm --filter @paparazzi/web dev
```

The web reads the API at `API_BASE` (default `http://localhost:3000`) and
proxies the browser's `/api/*` calls there; open `http://localhost:3002/`
(marketing site) and `http://localhost:3002/shop`. Without `WEB_API_TOKEN`
the shop shows TEST demo looks with a "Demo data" badge; with one (below)
it reads the seeded looks live. Checks:

```sh
pnpm typecheck
./node_modules/.bin/vitest run
./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts
DEMO_TARGET=postgres ./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts
pnpm --filter @paparazzi/web build
```

(`tsx` is not at the repo root, hence the api package's copy; `pnpm demo`,
`pnpm demo:pg`, `pnpm seed` and `pnpm seed:network` wrap the same lines.) A
database migrated before `schema_migrations` existed needs
`node db/migrate.mjs --baseline` once — the plain run fails loudly on `0001`
with a hint, by design ([`db/README.md`](db/README.md)).

**Minting the shop's links (dev)** — consumers only see links that exist.
`packages/api/scripts/mint-links.mjs` (shipped in the api image) mints one
tracked link per live offer for a placement, idempotently
(`Idempotency-Key: mint-links:<placement>:<offer_id>`; re-runs are no-ops).
Against the API on 3000 with the network seed applied, the shop's read-only
token and a dry run of the links:

```sh
JWT_SECRET=dev-only-change-me node packages/api/scripts/mint-dev-token.mjs --org-id "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from organisations where slug='afflino'")" --role publisher_analyst --sub web-shop
API_BASE=http://127.0.0.1:3000 API_TOKEN="$(JWT_SECRET=dev-only-change-me node packages/api/scripts/mint-dev-token.mjs --org-id "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from organisations where slug='afflino'")" --role publisher_owner)" node packages/api/scripts/mint-links.mjs --placement "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from placements where placement_key='network-shop-web'")" --dry-run
```

The first line prints the value for `WEB_API_TOKEN`; `web_placement_id` from
the seed's JSON is `WEB_PLACEMENT_ID` (both for the web server's environment).
Drop `--dry-run` to mint. The tokens are the JWT dev stub
(`mint-dev-token.mjs`, default TTL 8 h) until an identity provider lands.

**Production** — afflino.com on a single Linode (edge, services, Postgres
and Redis in one compose project): "Deploying afflino.com" below and
[`docs/runbooks/deploy.md`](docs/runbooks/deploy.md).

**Real-Postgres demo** — `DEMO_TARGET=postgres` runs the 51-assertion money
loop on a scratch database `paparazzi_demo_<8 hex>` created on the
`DATABASE_URL` server and dropped at exit (verified on PostgreSQL 16.13:
51 PASS, 0 FAIL, 0 scratch databases left). Same assertions as pg-mem, no
shims ([`db/README.md`](db/README.md)).

## Deploying afflino.com on Linode

**Status (2026-09-29): afflino.com is live on the owner's Linode,
172.105.52.150.** The owner created the Linode for Afflino ("linode is
ready"), gave its address ("172.105.52.150 THIS IS LINODE IP"), pointed
DNS at it (GoDaddy `A @` → 172.105.52.150, the `www` CNAME kept, no AAAA)
and ran the installer below. Checked from outside at 17:20 UTC the same
day: afflino.com and www.afflino.com answer over HTTPS with Let's Encrypt
certificates for both names (issued that day, valid to 2026-12-28, per the
public certificate-transparency logs); every public page, the app areas
and all 14 static assets return 200; www and plain HTTP redirect to the
apex; the security headers are present; `/api/healthz` answers
`{"ok":true}`; and search engines are kept out (`SITE_INDEXING=off`).
That check ran against f7046bd; later commits reach the server when the
owner re-runs the same line.

**The one command**, as root on a fresh Ubuntu 24.04 Linode dedicated to
Afflino (log in with `ssh root@afflino.com`, or Cloud Manager → the Linode →
Launch LISH Console):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
```

It checks the server (root, Ubuntu 24.04 / 22.04 or Debian 12, a server of
its own — no other Docker compose project, ports 80/443 free — memory: a
2 GB swapfile on plans under 4 GB), installs the packages, Docker (get.docker.com), ufw (OpenSSH first,
then 80/tcp, 443/tcp, 443/udp), fail2ban and automatic security updates,
clones the branch into `/opt/afflino` (and continues with that checkout's
copy of the installer), writes `/etc/afflino/afflino.env`
(root, 0600) with every secret generated and never printed — the only
question is an optional email for the Let's Encrypt account — builds the
images, runs the migrations on their own, starts the stack, waits
for it to be healthy, sets up a daily database backup and prints the
status: the server's IPv4 / IPv6, whether afflino.com and www.afflino.com
point at it, and the exact DNS records to set if not
([`deploy/linode/`](deploy/linode/README.md),
[`docs/runbooks/deploy.md`](docs/runbooks/deploy.md) §1).

**DNS at GoDaddy** (My Products → afflino.com → DNS → DNS Records): `A @` =
the Linode's IPv4 (delete every other `A @`, e.g. GoDaddy's parking
3.33.130.190 and 15.197.148.33), `AAAA @` = the Linode's IPv6, keep `CNAME
www` → `@`, and delete GoDaddy domain forwarding if it is set up. With
GoDaddy API access (accounts with 10+ domains or a Discount Domain Club
plan, and a personal access token with the DNS scope or an API key and
secret) `bash /opt/afflino/affiliate/deploy/linode/godaddy-dns.sh` sets them
instead (hidden prompts; the credentials are never stored). Certificates for
afflino.com and www.afflino.com are then issued automatically; watch with
`docker logs -f afflino-edge-1 2>&1 | grep -i certificate`.

| To | Run as root on the Linode (one line each) |
|---|---|
| Update (re-run: keeps the secrets, backs up first when something changed, keeps the release before as the git tag `afflino-previous`, changes nothing when nothing did) | `bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)` |
| Roll back a code-only release to the one before the last update (`docs/runbooks/deploy.md` §3) | `cd /opt/afflino && git checkout afflino-previous && cd affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d --build` |
| Open the site to search engines (the owner's call; the figures are confirmed) | `sed -i 's/^SITE_INDEXING=.*/SITE_INDEXING=on/' /etc/afflino/afflino.env && bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)` |
| Health | `curl -s http://127.0.0.1:3000/healthz; curl -s http://127.0.0.1:3001/healthz; curl -s http://127.0.0.1:3002/api/healthz; curl -s https://afflino.com/api/healthz; echo` |
| Services | `cd /opt/afflino/affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml ps` |
| Logs | `cd /opt/afflino/affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml logs -f --since 15m` |
| Back up now (daily at 02:30 UTC anyway; 14 kept in `/var/backups/afflino`) | `bash /opt/afflino/affiliate/deploy/linode/backup.sh manual` |
| Check the newest backup restores (scratch database; live untouched) | `bash /opt/afflino/affiliate/deploy/linode/restore.sh` |
| Replace the live database with the newest backup (asks you to type REPLACE) | `bash /opt/afflino/affiliate/deploy/linode/restore.sh --replace-live` |
| Copy the backups off the server (on your own computer) | `scp -r root@afflino.com:/var/backups/afflino .` |

**Owner actions in Linode Cloud Manager** (optional, recommended): a Cloud
Firewall on the Linode (inbound Drop; accept TCP 22, 80, 443 and UDP 443;
outbound Accept), and Linode Backups (whole-disk snapshots, including the
environment file). **Plan**: 4 GB recommended; sizing for
Afflino's real traffic is unmeasured — about 166 MiB for the whole stack at
idle, the web image build needs more for a minute or two, and the load soak
has never run ([`docs/capacity-plan.md`](docs/capacity-plan.md)).

**What stays demo on the live site**: no merchant programme exists (the
shop shows labelled TEST demo looks until a real programme exists);
sign-in is the JWT stub (`/login` takes a pasted token; no accounts, OTP
or KYC); the payout rail is the stub. The figures on the public pages
(`packages/web/lib/site-copy.ts`) are the owner's, confirmed on 2026-09-29;
the terms, privacy and contact pages are still stubs and the #ad
disclosure wording still waits for counsel. `SITE_INDEXING` stays `off`
until the owner turns it on. Still open before
real traffic: an identity provider, webhook signature verification, rate
limiting, a CSP, monitoring, off-server backups and a restore drill on the
server, the load soak and counsel's decisions
([`docs/pilot-checklist.md`](docs/pilot-checklist.md),
[`docs/runbooks/deploy.md`](docs/runbooks/deploy.md) §7).

## Deploying afflino.com

What the installer (above) deploys: the shape, rehearsed end to end on one
machine with the edge in plain-HTTP mode (below). The step-by-step
procedure, rollback, the kill-switch drill and backups are in
[`docs/runbooks/deploy.md`](docs/runbooks/deploy.md).

**Shape (single host, the pilot).** One compose project (`name: afflino`)
from [`docker-compose.prod.yml`](docker-compose.prod.yml) plus
[`docker-compose.single-host.yml`](docker-compose.single-host.yml):

| Service | Image | Listens | Role |
|---|---|---|---|
| `edge` | `caddy:2-alpine` + [`docker/Caddyfile`](docker/Caddyfile), host networking | **80, 443/tcp, 443/udp on all interfaces, IPv4 and IPv6 — the only public listener** (sees real client addresses; ufw applies) | TLS with automatic certificates for `SITE_HOST` and `www.SITE_HOST` only (no on-demand TLS); `www` → 301 to the apex keeping path and query; `/r/*` → redirect; everything else → web; HSTS (no preload), nosniff, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, no `Server` / `Via` / `X-Powered-By`; no CSP yet (open); overwrites client-supplied `X-Forwarded-For` / `X-Real-IP` / `Forwarded`; no access log |
| `web` | `paparazzi/web` | 127.0.0.1:3002 | the Afflino site, app areas and shop; serves `/api/*` as its same-origin proxy to the API, so the API is not public — provider webhooks and payout callbacks use `https://afflino.com/api/v1/...` |
| `redirect` | `paparazzi/redirect` | 127.0.0.1:3001 | `GET /r/{token}` → 302 with `subid`, no cookies, keyed hash of the client address |
| `api` | `paparazzi/api` | 127.0.0.1:3000 | the v1 API |
| `workers` | `paparazzi/workers` | — | BullMQ workers, outbox relay, retention purge |
| `migrate` | `paparazzi/migrate` | — | one-shot `node db/migrate.mjs` before api / redirect / workers start; also runs the seeds |
| `postgres` | `postgres:16-alpine` | — (no published port) | volume `afflino_pgdata`; healthcheck |
| `redis` | `redis:7-alpine` | — (no published port) | `--appendonly yes`, volume `afflino_redisdata`; healthcheck |

The 127.0.0.1 ports are for checks and operator scripts on the server
(Docker's published ports bypass ufw, which is why nothing but the edge
binds publicly). Managed databases remain an option: drop
`docker-compose.single-host.yml` and set `DATABASE_URL` / `REDIS_URL`
([`docs/infrastructure-recommendation.md`](docs/infrastructure-recommendation.md)).
[`docker-compose.edge-test.yml`](docker-compose.edge-test.yml) switches the
edge to plain HTTP on 127.0.0.1:8088 for any Host (no certificates) to
rehearse routing before DNS points at the server. The edge reaches redirect
and web on their 127.0.0.1 ports (`REDIRECT_UPSTREAM` / `WEB_UPSTREAM`), and
its admin API is off.

**The command line** the installer runs (from `affiliate/`, with the
environment file it writes; it adds `--remove-orphans` and
`BUILDX_NO_DEFAULT_ATTESTATIONS=1`, see `deploy/linode/README.md`):

```sh
docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d --build
```

**First deploy** = the installer (the site comes up with labelled TEST
demo data and every page noindex); optionally the TEST network seed, the
shop's placement and read-only token written into the environment file,
`up -d web`, and the shop's links, to exercise tracked links — the exact
lines are [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md) §1 step 6.
DNS: `A @` and `AAAA @` of afflino.com (GoDaddy) point at the Linode; `www`
stays a CNAME to the apex.

**Environment contract** ([`.env.prod.example`](.env.prod.example) has each
one with its comment). Required on the single host: `POSTGRES_PASSWORD`,
`JWT_SECRET`, `STUB_WEBHOOK_SECRET`; everything else has a production
default or is optional.

| Variable | Required? | Default | Secret? | Read by |
|---|---|---|---|---|
| `POSTGRES_PASSWORD` | **yes** with `docker-compose.single-host.yml` (URL-safe: `openssl rand -hex 32`) | — | **yes** | postgres; written into `DATABASE_URL` |
| `POSTGRES_USER`, `POSTGRES_DB` | no | `afflino`, `afflino` | no | postgres (single host) |
| `DATABASE_URL`, `REDIS_URL` | **yes** without the single-host override (ignored with it); an empty value stops the stack (migrate fails, services refuse to boot) | — | **yes** (`DATABASE_URL` carries the password) | api, redirect, workers; migrate (`DATABASE_URL`) |
| `JWT_SECRET` | **yes** | — | **yes** | api (signs the dev-stub tokens, `WEB_API_TOKEN` included) |
| `STUB_WEBHOOK_SECRET` | **yes** | — | **yes** | workers |
| `IP_HASH_KEY` | no — strongly recommended, before the first real click (≥ 32 characters) | empty = plain SHA-256 | **yes** | redirect (`ip_hash` = HMAC-SHA256(key, ip)) |
| `SITE_HOST` | no | `afflino.com` | no | edge; defaults of `REDIRECT_BASE_URL`, `SITE_URL`, `WEB_HOST` |
| `ACME_EMAIL` | no | empty (no email on the ACME account) | no | edge |
| `SITE_INDEXING` | no | `off` (pre-launch: robots.txt `Disallow: /`, empty sitemap, noindex on every page) | no | web (runtime) |
| `SITE_URL` | no | `https://${SITE_HOST}` | no | web (runtime: canonical, og:url, robots.txt, sitemap) |
| `REDIRECT_BASE_URL` | no | `https://${SITE_HOST}` | no | api (links are `<this>/r/<token>`) |
| `TRUST_PROXY` | no | `loopback,uniquelocal` | no | api, redirect (unset in the code = trust nothing) |
| `WEB_API_TOKEN` | no — until set, TEST demo data with a badge | empty | **yes** | web (server only) |
| `WEB_PLACEMENT_ID` | no — until set, items carry no link | empty | no | web |
| `API_BASE` | no | `http://api:3000` | no | web (runtime; `/api/*` proxy target) |
| `NEXT_PUBLIC_API_BASE` | no | `/api` | no | web **build** argument |
| `NEXT_PUBLIC_SITE_NAME` | no | `Afflino` | no | web (runtime) |
| `RETENTION_CLICK_CONTEXT_DAYS`, `RETENTION_CONVERSION_RAW_DAYS`, `RETENTION_OUTBOX_DAYS`, `RETENTION_CRON` | no | `365`, `365`, `365`, `0 3 * * *` (counsel placeholders) | no | workers |
| `NETWORK_FILE` | no | empty = the image's TEST example | no | migrate (`seed-network.ts`) |
| `WEB_HOST` | no | `${SITE_HOST}` | no | migrate (`seed-network.ts`: the shop's property and placement) |
| `SEED_OWNER_EMAIL`, `SEED_OPERATOR_EMAIL`, `SEED_APPROVER_EMAIL`, `SEED_ADMIN_EMAIL` | no; passed to a seed run with `-e`, not stored | `<role>@afflino.invalid` | no | migrate (`seed-network.ts`) |
| `IMAGE_TAG` | no | `latest` | no | compose (image tags) |
| `LOG_LEVEL` | no | `info` | no | passed to the services; none reads it today |
| `DEMO_TARGET`, `DEMO_DATABASE_URL` | dev only | — | — | `scripts/demo-money-loop.ts` |

Fixed in the compose file, not read from the environment file:
`NODE_ENV=production` (api, redirect, workers, web), `API_HOST`,
`API_PORT`, `REDIRECT_PORT`, and the edge's `EDGE_ADDRESS`
(`<SITE_HOST>, www.<SITE_HOST>`; `:8088` in the test override, with
`EDGE_BIND=bind 127.0.0.1`), `REDIRECT_UPSTREAM=127.0.0.1:3001` and
`WEB_UPSTREAM=127.0.0.1:3002`.

**The indexing gate.** `SITE_INDEXING=on` is the owner's switch to let
search engines in: robots.txt then allows the public pages (the app areas,
`/join`, `/login`, `/api`, `/dev`, `/saved` stay disallowed) and names
`https://afflino.com/sitemap.xml`, which lists `/`, `/shop` and
the live, non-TEST looks (the look pages of demo and TEST looks are
`noindex, nofollow`). Until then (the default) robots.txt is
`Disallow: /`, the sitemap is empty and every page carries
`noindex, nofollow`, so the owner decides when search engines come in.
The figures are confirmed (2026-09-29); the terms, privacy and contact
pages are still stubs (they stay out of the sitemap). Flipping it is a
restart of the web, not a rebuild.

**Client addresses.** The edge runs with host networking, so the address
it sees is the client's own, over IPv4 and IPv6 (a port Docker publishes
would hand IPv6 clients to Caddy through Docker's userland proxy, from the
compose network's gateway address; that is why the AAAA record waited for
this). api and redirect trust `X-Forwarded-For` from loopback and any
private-range peer (`TRUST_PROXY=loopback,uniquelocal`,
`packages/shared/src/trust-proxy.ts`). The only such peers are the stack's
own containers and Docker's proxy for the 127.0.0.1-published ports, which
is how the host-networked edge reaches them; nothing outside the server can
connect to those ports, and the edge replaces whatever a client sends. The redirect stores `ip_hash` = HMAC-SHA256(`IP_HASH_KEY`, the
address the edge saw) — keyed so it cannot be reversed by enumerating IPv4
addresses; without the key it falls back to the plain SHA-256 of before. No
log carries the address (api and redirect log method, url and hostname; the
edge has no access log). A stable keyed hash is still pseudonymous data:
what it is under DPDP, who holds the key and how long it is kept are counsel
items ([`docs/threat-model.md`](docs/threat-model.md) §4.11), not claims.

**Rehearsed on 2026-09-29** (with the edge still on the compose network;
the host-networked edge and the installer were rehearsed afterwards, see
[`deploy/linode/README.md`](deploy/linode/README.md) "What was checked":
there the spoofed click's `ip_hash` was HMAC(`IP_HASH_KEY`, 127.0.0.1), the
address the edge really saw) (this sandbox, images rebuilt from this tree,
throwaway project, TEST secrets, prod + single-host + the plain-HTTP edge on
127.0.0.1:8088, `Host: afflino.com`): every service up (migrate exited 0),
only the edge on 8088 and api / redirect / web on 127.0.0.1; `/` 200 with
`<link rel="canonical" href="https://afflino.com"/>` and
`og:url` `https://afflino.com`; with `SITE_INDEXING=off` robots.txt
`Disallow: /` without a sitemap line, an empty sitemap and
`noindex, nofollow` on `/` and `/shop`; `/api/healthz` 200 through the edge;
headers HSTS / nosniff / Referrer-Policy / `X-Frame-Options: DENY`, no
`Server` / `Via`; `Host: www.afflino.com` `/shop?utm_source=test&x=1` → 301
`https://afflino.com/shop?utm_source=test&x=1`; the TEST network seed
(`--with-demo-programme`, `WEB_HOST=afflino.com`, NODE_ENV unset in the
migrate image) + the tokens + `up -d web` + mint-links (`minted=1 ...
failed=0`); the look page shows `https://afflino.com/r/<token>`;
`GET /r/<token>` through the edge → 302 with `subid`, no `set-cookie`; a
request with `X-Forwarded-For`, `X-Real-IP` and `Forwarded` all spoofed
stored the same `ip_hash` as a plain one, equal to HMAC(`IP_HASH_KEY`, the
compose network's gateway — the peer the edge sees for a host-local curl)
and not to the HMAC of any spoofed address; zero log lines with either
address; a `network_admin` token whose subject is not a user → pause 500,
status still `active`, no audit or outbox row, the link still 302; a real
pause / resume → paused page 200 / 302 again; with `SITE_INDEXING=on`
robots.txt allowing the public site with the sitemap line and a sitemap of
`/`, `/shop`, `/contact` (the TEST looks left out); a 5 MB body → 413
at the edge; the edge in HTTPS mode (internal CA, `afflino.internal`) as in
[`docs/runbooks/deploy.md`](docs/runbooks/deploy.md) §1R; then `down -v`:
no container, volume or network left. Not done: a real certificate for
afflino.com and any check over the internet — they need the DNS change and
the server. (That record predates the review fixes of the same day, which
took `/contact` out of the sitemap, made the look pages of TEST and demo
looks `noindex, nofollow`, added a pre-launch notice (removed the same day,
once the owner confirmed the figures) and gave the edge's
own 502 / 413 the security headers; the installer rehearsal after them is
in [`deploy/linode/README.md`](deploy/linode/README.md) "What was checked".)

## Setup

Prerequisites: **Node 22** (`engines` ≥ 20), **pnpm 9.12.0** (`packageManager`;
CI and the images use the same version), **Docker**.

```sh
pnpm install                 # already run at scaffold time; re-run after pulling
docker compose up -d         # postgres :5432 + redis :6379 (or: pnpm dev:db)

cp .env.example .env         # adjust as needed
node db/migrate.mjs          # or: pnpm migrate
```

Per-package dev servers:

```sh
pnpm --filter @paparazzi/api dev
pnpm --filter @paparazzi/redirect dev
pnpm --filter @paparazzi/workers dev
pnpm --filter @paparazzi/web dev
```

Typecheck everything:

```sh
pnpm typecheck
```

## Demo

The end-to-end money loop runs **in-process** — no Docker, no real database,
no real money:

```sh
pnpm demo
```

`scripts/demo-money-loop.ts` boots a pg-mem Postgres, applies `db/migrations/*.sql`
(with the pg-mem shims documented at the top of the script), swaps the API's pool
via the `__setPool` test seam, and serves the API + redirect apps over real HTTP
on `127.0.0.1` ephemeral ports. It then walks the full money loop and asserts
every step — **51 assertions, all PASS** (any failure sets a non-zero exit code):

1. Mint a tracked link (`POST /v1/links` → 201, 32-hex token).
2. Click the redirect (`GET /r/{token}` → 302, `subid=<click_id>` in Location).
3. Approved conversion webhook: INR 2000 order → INR 160 commission (202).
4. Earnings + ledger: 70/30 split → publisher INR 112 / platform INR 48; books balance.
5. Duplicate webhooks dedupe (200 `{deduped:true}`; exactly 1 conversion, 3 ledger rows).
6. 50% reversal → publisher INR 56 / platform INR 24.
7. Merchant settlement `STMT-DEMO-1` (INR 160 collected).
8. Prepare payout batch → 201, item INR 56 (threshold INR 50, deliberately low).
9. Maker-checker: preparer approving own batch → 403.
10. Approver approves → `approved`.
11. Disburse → `processing`, one `payout_transfers` row.
12. Provider callback `paid` → batch `paid`; `publisher_liability` nets to 0;
    `payout_clearing` holds the 5600 Cr pending bank reconciliation.
13. **PAYOUT-FAILURE scenario** (second conversion, INR 80 commission → new INR 56 batch):
    - ambiguous provider outcome → callback `unknown`, batch stays `processing`, no ledger;
    - **blind re-disburse refused**: 409 `TRANSFER_STATUS_UNKNOWN`, still exactly one
      transfer row, `provider_ref` unchanged — a status query is required before any retry;
    - `POST /v1/payout-transfers/{providerRef}/status-query` → 200, records
      `last_status_query_at` and arms the 5-minute retry guard;
    - informed retry re-initiates the **same** transfer (`unknown` → `processing`),
      still one row — **no double payout**;
    - provider callback `paid` → batch paid, `publisher_liability` 0,
      `payout_clearing` holds 11200 Cr (2 × 5600), books still balanced.

Expected output: `PASS …` lines per step, then the money-trail summary
(commission 16000 → split 11200/4800 → post-reversal 5600/2400 → settlement
`STMT-DEMO-1` → two paid INR-56 batches → clearing 11200), ending with
`All demo assertions passed.`

Sandbox guards: the script **refuses to run with `NODE_ENV=production`**
(loud `REFUSING TO RUN` + exit 1). All demo/seed data is unmistakably fake —
`Demo …` names, `demo.`-prefixed accounts/URLs, `txn-demo-*` / `demo-line-*`
transaction refs, `STMT-DEMO-*` statements, RFC 2606 `example.com` domains —
and the payout rail is a stub (see `packages/api/src/payout-rail.ts`).

The same 51 assertions run on a **real Postgres** with `DEMO_TARGET=postgres`
(`pnpm demo:pg`): the migrations are applied verbatim through
`db/migrate.mjs` (no pg-mem shims), on a scratch database
`paparazzi_demo_<8 hex>` created on the `DATABASE_URL` server and dropped at
exit even when a step fails; `DEMO_DATABASE_URL` names an *empty* database to
use as-is instead. Verified on PostgreSQL 16.13 — no assertion differs between
the two targets ([db/README.md](db/README.md)).

## Retention purge

Raw tracking payloads age out on a schedule; financial and governance records
never do. Three classes — aged `clicks.context` / `conversions.raw` payloads
are nulled, aged **published** outbox rows are deleted — with per-class
windows from `RETENTION_CLICK_CONTEXT_DAYS` / `RETENTION_CONVERSION_RAW_DAYS` /
`RETENTION_OUTBOX_DAYS` (conservative sandbox default: 365 days each; counsel
may shorten — see `docs/counsel-briefing.md` §1). `ledger_entries`,
`audit_log`, and `adjustments` are never touched, so publisher statements stay
reproducible after every purge.

```sh
# one-off run (same code path the scheduled job uses)
pnpm --filter @paparazzi/workers purge:retention
# dry-run: report what would be purged, write nothing
pnpm --filter @paparazzi/workers purge:retention -- --dry-run
```

In production the workers service registers a daily BullMQ repeatable job
(`retention` queue, `RETENTION_CRON`, default `0 3 * * *`) at startup. Each run
writes one `audit_log` row per org per class (`action='retention.purge'`).
Details: [workers README](packages/workers/README.md) ·
[assumptions](packages/workers/ASSUMPTIONS.md).

## Backup & restore

Daily `pg_dump -Fc` of the Postgres database, verified immediately
(`pg_restore --list`), hashed (SHA-256), and described by a JSON manifest
(timestamp, DB name, PG version, digest, row counts of the money-critical
tables) written next to the dump. The restore drill replays a dump into a
scratch database and validates it: per-table row counts vs the manifest,
plus the ledger double-entry invariant
(`sum(debit_minor) == sum(credit_minor)` per currency over `ledger_entries`).

```sh
BACKUP_DIR=./backups scripts/backup.sh
scripts/restore.sh "$(ls -t ./backups/*.dump | head -1)"
```

Connection: `DATABASE_URL` first, else `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/
`PGDATABASE` (defaults match `docker-compose.yml`; no default password —
supply `PGPASSWORD`, `~/.pgpass`, or a URL). **Safety:** `backup.sh` refuses
targets whose host or DB name looks production-like (`prod|prd|production|
live`) unless `PAPARAZZI_ALLOW_PROD=yes` is set explicitly; `restore.sh`
drops and recreates its scratch target (`paparazzi_restore_drill` by
default) and hard-refuses anything production-like with no override.
Full procedure, schedule, retention proposal, and the pilot-gate evidence
checklist: [backup/restore runbook](docs/runbooks/backup-restore.md) ·
[assumptions](scripts/ASSUMPTIONS.md).

**On the single-host Linode** these two do not apply as-is (the server has
no Postgres client and the database no published port):
[`deploy/linode/backup.sh`](deploy/linode/backup.sh) and
[`restore.sh`](deploy/linode/restore.sh) run `pg_dump` / `psql` inside the
postgres container — a daily timer, gzip, 0600, 14 kept, and a restore
check into a scratch database with the same ledger-balance check ("Deploying
afflino.com on Linode" above, `docs/runbooks/deploy.md` §5).

## Infrastructure & deployment

The owner has chosen **Linode** (2026-09-29) and created a server for
Afflino; nothing has been deployed to it from this repository, and no real
credentials exist here. One command installs and updates it
([`deploy/linode/install.sh`](deploy/linode/install.sh), "Deploying
afflino.com on Linode" above). The pilot shape is a single host — the edge (Caddy),
api, redirect, workers, web, migrate, Postgres 16 and Redis 7 in one compose
project ("Deploying afflino.com" above,
[docs/runbooks/deploy.md](docs/runbooks/deploy.md)); managed databases
remain an option (drop the single-host override, set `DATABASE_URL` /
`REDIS_URL`). The earlier AWS / DigitalOcean recommendation, the trade-offs
of self-hosted databases for a ledger, backup strategy, monitoring and the
DPDP open questions for counsel:
[docs/infrastructure-recommendation.md](docs/infrastructure-recommendation.md).

The five images in `docker/` build and boot end to end, and the edge runs
the stock `caddy:2-alpine` with [docker/Caddyfile](docker/Caddyfile)
([docker/README.md](docker/README.md): build steps, runtime layout, sizes,
the edge, the recorded smoke test from migrate through the edge to a `302`
with `subid`). Environment contract: [.env.prod.example](.env.prod.example)
— every variable, required or optional, secret or not, with its default;
the filled copy is never committed. Secret generation, the single-host
secrets file, rotation cadence, and the pre-launch checklist:
[docs/credential-setup.md](docs/credential-setup.md).

## Repo map

| Path | What lives there |
|---|---|
| `packages/shared/` | Cross-package contract: error codes, event envelope, domain entities, connector interface, ledger math. Zero runtime deps. See [README](packages/shared/README.md) · [assumptions](packages/shared/ASSUMPTIONS.md) |
| `packages/api/` | Merchant/publisher-facing HTTP API (Fastify). See [README](packages/api/README.md) · [assumptions](packages/api/ASSUMPTIONS.md) |
| `packages/redirect/` | Click-tracking redirect service (Fastify). See [README](packages/redirect/README.md) · [assumptions](packages/redirect/ASSUMPTIONS.md) |
| `packages/workers/` | BullMQ workers: ingestion, attribution, ledger posting, payouts. See [README](packages/workers/README.md) · [assumptions](packages/workers/ASSUMPTIONS.md) |
| `packages/web/` | The Afflino web app (Next.js 14): marketing site, onboarding, creator / brand / agency areas, admin, and the consumer shop at `/shop` (live against the catalogue API). Route map, artboards and live / demo status: [README](packages/web/README.md) · [assumptions](packages/web/ASSUMPTIONS.md) |
| `db/` | Postgres schema, migration runner with `schema_migrations` tracking, demo seed, in-house network seed and its example network file. See [README](db/README.md) |
| `docker/` | The five images (api, redirect, workers, web, migrate) and their build script. See [README](docker/README.md) · [assumptions](docker/ASSUMPTIONS.md) |
| `docs/` | OpenAPI spec, pilot checklist, action tracker, capacity plan, threat model, runbooks, alert definitions, infrastructure recommendation |

## API reference (OpenAPI)

[docs/openapi.yaml](docs/openapi.yaml) is the OpenAPI 3.1 spec for the v1 API,
written from the real route handlers (`packages/api/src/routes/*.ts`) — every
registered route is documented, nothing is invented. It covers the catalogue
(`GET /v1/looks`, `GET /v1/looks/{id}` with the live offer and tracked link
per item; never a merchant URL), link minting with its guard error codes (`PROGRAMME_NOT_APPROVED`, `OFFER_STALE`,
`PROPERTY_FORBIDDEN`, `PUBLISHER_NOT_ACTIVE`), the stub-network webhook and CSV
uploads, suspense ops, payout batches (prepare/approve/disburse + provider
callback), publisher earnings, disputes, programme pause/resume, publisher
onboarding, and contracts. The bearer-JWT auth scheme is explicitly marked as
a temporary stub to be replaced by a production IdP.

To view it:

- Paste the file into [editor.swagger.io](https://editor.swagger.io) (import
  file → renders instantly, no install).
- Or serve it locally with Redocly (not installed here; one-time setup):
  `npm i -g @redocly/cli && redocly preview-docs docs/openapi.yaml`.
- Conformance is CI-checked: `packages/api/test/openapi.test.ts` parses the
  YAML, pins the expected route list to the real app via
  `app.hasRoute()`, and asserts the spec documents exactly those routes plus
  the shared error-code enum. Run with `vitest run packages/api/test/openapi.test.ts`.

## Security

[docs/threat-model.md](docs/threat-model.md) is the pre-pentest review for this
sandbox: trust boundaries (public `/r/:token` path, the web app's creator and admin areas, finance
endpoints, webhook/CSV ingestion, workers, database), a per-component STRIDE
analysis with every mitigation tied to the code or test that implements it
(tenant isolation via `tenantQuery`, payout maker-checker, the no-guess
attribution rule, link-mint guards, the programme kill switch), residual risks
that must be fixed before any shared environment (JWT auth stub, no
provider-signature verification on the webhook ingress, dev secrets, pg-mem vs
real Postgres divergence, counsel-pending retention windows), a proposed
pentest scope, and open questions for humans (IdP choice, webhook signing,
payout rail, retention windows, secrets management).

## Assumptions (global)

- **HTTP:** Fastify 4 for `api` and `redirect` — one framework, shared plugins.
- **Queues/events:** BullMQ 5 + Redis for background jobs and the event pipeline
  (ingestion → attribution → ledger posting → payouts).
- **Data access:** raw SQL via `pg`, no ORM. The ledger is money; every insert
  is explicit, auditable SQL with no hidden queries.
- **Auth:** JWT bearer stub for now; a real identity provider replaces the
  stub before any shared environment. `JWT_SECRET` in `.env.example` is
  dev-only.
- **Dev-run / typecheck:** `tsx` for dev servers (`pnpm --filter … dev`),
  `tsc --noEmit` for typechecking (`pnpm typecheck`).
- **Web:** Next.js 14 (App Router, CSS Modules) for the Afflino web app and the shop.
- **Money:** integer minor units (paise) everywhere — see `MinorUnits` in
  `packages/shared`. Negatives are rejected; deductions are positive amounts
  on the opposite ledger side.
- **No secrets in the repo:** `.env.example` carries placeholders only;
  real `.env` files are gitignored.
- **Backup/restore:** `scripts/backup.sh` (verified `pg_dump -Fc` + JSON
  manifest) and `scripts/restore.sh` (scratch-DB drill with row-count and
  ledger-balance checks); production guards and open infra questions in
  [scripts/ASSUMPTIONS.md](scripts/ASSUMPTIONS.md).

## Integration notes (2026-09-29, the Afflino web app)

`packages/web` was rebuilt to the owner's design handover for **Afflino**, an
India-first affiliate network, and the consumer shop moved under it:

- **Routes** (`packages/web/README.md` has the full map with artboard ids):
  `/` marketing site, `/login` dev sign-in (paste the JWT stub; no real
  sign-in exists), `/join` onboarding, `/app/*` creator app, `/brand/*`
  brand workspace (`?workspace=<client id>` for an agency), `/agency`,
  `/admin/*`, and the consumer shop at `/shop`, `/looks/[id]`,
  `/looks/[id]/items/[itemId]`, `/saved`. The old `/portal/*` and
  `/console/*` URLs 307 to their new homes.
- **Live today** (through the web's same-origin `/api` proxy, with the dev
  token from `/login`): `GET /v1/publisher/earnings` (overview and payouts
  balances), `POST /v1/links` (the tracked `/r/{32-hex}` link), `GET` /
  `POST /v1/disputes`, `GET /v1/suspense` + retry / review, `POST
  /v1/publishers` (creator / publisher sign-up); server-side, the shop's
  `GET /v1/looks` and `GET /v1/looks/:id`. **Everything else is TEST demo
  data** with a visible "Demo data" badge, and the demo flows (OTP, platform
  connect, PAN "Verified", wallet top-up, withdrawals, brand approvals,
  admin decisions) say that nothing was verified, sent or charged.
- **Placeholders**: every marketing figure, price, fee, the TDS rate, the
  7-day validation window, the ₹500 minimum withdrawal and the `#ad`
  disclosure line are in `packages/web/lib/site-copy.ts`, pending business
  and counsel confirmation (`docs/pilot-checklist.md`,
  `docs/action-tracker.md`). Offer copy says "attribution window", never
  "cookie": the redirect sets none, and the design's readable
  `/r/{handle}/{offer}` links are not implemented.
- **Site name**: the deployed default is now `Afflino`
  (`NEXT_PUBLIC_SITE_NAME`); a rename is a restart.
- No API, database or image layout changed; `docker/Dockerfile.web` is
  unchanged. The web build gained one dependency, `qrcode-generator` (MIT,
  the QR download on `/app/links`).

## Integration notes (2026-09-22, phase 4 — suspense queue operations view)

- **Migration** `db/migrations/0004_suspense_ops.sql`: nullable
  `conversions.reviewed_at` / `reviewed_by` / `review_note` (+ index on
  `(org_id, received_at desc)`). No worker, connector, or webhook path ever
  writes them — the suspense read model (`click_id IS NULL`) is untouched.
- **Ops API** (`packages/api/src/routes/suspense.ts`, roles
  `finance_operator` / `finance_approver` / `network_admin`):
  - `GET /v1/suspense` — list suspense entries with programme name, raw
    provider payload (`conversions.raw`), and a data-derived `reason_code`
    (`CLICK_REF_UNMATCHED` = ref present but no click; `NO_CLICK_REF` = no
    ref). Filters: `connector`, `programme_id`, `received_from`/`received_to`,
    `reviewed`; `limit`/`offset` pagination with `total`.
  - `POST /v1/suspense/:id/retry` — re-runs attribution: binds `click_id` in
    a transaction only on an EXACT `returned_click_ref` → `clicks.click_id`
    match, then writes `audit_log` + `suspense.attributed` outbox event.
    No match → `{attributed:false}` with the row untouched; NULL ref → 422
    (nothing deterministic to retry against — no fuzzy matching, ever).
  - `POST /v1/suspense/:id/review` — marks reviewed with a required note
    (min 10 chars) + `audit_log` entry. Changes no attribution and posts no
    ledger entries, by construction.
- **Policy** (enforced in code): unknown attribution stays unknown. Retry
  never guesses a publisher (no LIKE, no timestamp/IP correlation); items
  without a reference can only be resolved by human review with recorded
  evidence. A late-attributed row emits `suspense.attributed` on the outbox
  so a downstream consumer can run ledger posting — the API itself posts no
  ledger entries from this path.
- **Web**: operator console page at `/console/suspense` (since 2026-09-29
  `/admin/suspense`, `packages/web/app/admin/suspense/SuspenseQueue.tsx`): filters, per-row raw
  payload viewer, retry + mark-reviewed actions wired to the API, falling
  back to clearly-labelled demo data (`DEMO_SUSPENSE_ITEMS` in
  `lib/portal-demo.ts`, rendered with `<DemoBadge/>`) when the API is
  unreachable. Actions are disabled in demo mode.
- **Tests**: `packages/api/test/suspense-ops.test.ts` (12 tests) covers
  list/scoping/filters, retry no-match, retry after the matching click
  arrives (bind + audit + outbox), review note validation + audit,
  cross-tenant isolation, and the NULL-ref 422.

## Integration notes (2026-09-22, phase 4 — CSV merchant connector)

- **Endpoint** `POST /v1/integrations/csv/uploads` (roles `network_admin` /
  `editor`; body `{ provider_account_id, programme_id, filename, csv_text }`
  — the CSV travels as an inline string, no multipart; deliberate sandbox
  choice, 2 MB cap). Brief §8 file-based reporting for direct merchants
  without APIs.
- **One money path, two ingestion shapes**: webhook events and CSV rows both
  run the shared state machine in `packages/api/src/conversion-ingest.ts` —
  same idempotency key, same `provider_revision` ordering (approved never
  downgraded), same suspense rule (unknown `returned_click_ref` → `click_id
  NULL`, never guessed), same ledger posting on approved, same outbox events
  (`conversion.received` / `.status_changed` / `.reversed`).
- **Programme is uploader-supplied** (must exist in the org and be `active`;
  404/422 otherwise) — the webhook's click-chain resolution is not used.
- **All-or-nothing validation**: every row validated before anything is
  ingested; any invalid row → `422 VALIDATION_ERROR` with per-row `errors:
  [{row, reason}]` and zero inserts.
- **CSV format** (header required, names case-insensitive, extra columns
  ignored, blank lines skipped, UTF-8, LF/CRLF):
  `source_transaction_id` (req), `line_id` (opt), `returned_click_ref`
  (opt), `currency` (req, 3-letter, e.g. `INR`), `eligible_value_minor`
  (req, int ≥ 0), `commission_minor` (req, int ≥ 0),
  `provider_status` (req: `approved|pending|declined|reversed`),
  `provider_revision` (opt, int ≥ 0, default 0), `occurred_at` (req, ISO
  8601). Money is integer minor units — decimals (e.g. `12.50`) are rejected
  with a clear reason, never rounded. Sample:
  `packages/api/test/fixtures/sample-settlement.csv`.
- **Tests**: `packages/api/test/csv-connector.test.ts` (8 tests) — duplicate
  full-file upload (exactly one financial effect), malformed rows (422 +
  per-row reasons, zero inserts), out-of-order statuses (approved rev 2 then
  pending rev 1 → still approved, ledger unchanged), unknown click ref →
  suspense (also visible in `GET /v1/suspense` as `CLICK_REF_UNMATCHED`),
  ledger parity with the equivalent webhook event, fixture upload, programme
  guards, empty-file rejection.

## Integration notes (2026-09-22, phase 3 — pilot hardening)

- **Migration** `db/migrations/0003_phase3.sql`: `publishers.onboarding_state`
  (application → identity_review → property_verification →
  programme_eligibility → contract → active); `disputes` gains nullable
  `conversion_id`, `kind`, `publisher_id`, `subject`, `claim_ref`,
  `resolution_note`/`resolved_by`/`resolved_at` for missing-commission
  tickets; contract effective-dating is enforced by the API (no new columns).
- **Kill switch**: `POST /v1/programmes/:id/pause|resume` (network_admin).
  Pause sets status `paused` (blocks `POST /v1/links` immediately),
  deletes `route:{token}` keys for the programme's active links (Redis;
  DB fallback keeps behaviour correct without it), emits a `programme.paused`
  outbox event (picked up by the workers' outbox relay onto the `events`
  stream) and an `audit_log` row. Existing links serve the paused page;
  resume invalidates the cache again so a payload cached while paused cannot
  linger. Covered by tests incl. a fake-Redis invalidation assertion.
- **Link guards** (all in `POST /v1/links`): unapproved property → 403
  `PROPERTY_FORBIDDEN`; publisher onboarding not `active` → 403
  `PUBLISHER_NOT_ACTIVE` (new shared error code); stale/expired offer → 422
  `OFFER_STALE`; offer destination host not in the programme's
  `allowed_domains` → 403 `PROGRAMME_NOT_APPROVED` (no commissionable link
  is minted for unsupported merchant URLs). `GET /v1/offers` still only
  serves live offers — no fabricated prices.
- **Publisher onboarding**: `POST /v1/publishers` opens an application;
  `POST /v1/publishers/:id/onboarding/advance` (network_admin) walks the
  state machine one step at a time (409 on skips). Pending accounts can
  draft but not mint monetised links.
- **Disputes**: `POST /v1/disputes` (missing-commission tickets may name no
  conversion), `GET /v1/disputes[/:id]`, `POST /v1/disputes/:id/resolve`
  (network_admin/editor). Resolving requires `provider_verified: true` plus
  a resolution note — screenshots alone can never create a payable sale
  (422 otherwise). Resolution never posts ledger entries; the provider must
  re-report through the webhook path. Portal UI: `/portal/disputes` (since 2026-09-29 `/app/payouts/disputes`).
- **Contract versioning**: `POST /v1/contracts` (version = max+1,
  effective_from not earlier than the previous version's), `POST
  /v1/contracts/:id/approve` (network_admin), `GET /v1/contracts`. Ledger
  posting uses the latest approved contract whose `effective_from` has
  arrived; posted conversions keep their `contract_version_id` snapshot
  forever (tested: v1 11200 stays 11200 after v2 9600 takes effect).
- **Consent**: the API and redirect set no cookies and read none — denying
  consent changes nothing observable on the click path (asserted in tests);
  DPDP consent UX remains a counsel-gated pilot item.
- **Load**: `scripts/load/redirect-soak.js` (node stdlib only) + `pnpm
  load:smoke` / `pnpm load:soak`. Cannot run meaningfully against pg-mem;
  the pre-pilot gate (500 rps/15 min, p95 < 150 ms, 99.9% availability,
  p75 LCP ≤ 2.5 s) is recorded in `docs/pilot-checklist.md` as human-run.
- **Runbooks**: `docs/runbooks/` (tracking outage, wrong-product/rights,
  merchant nonpayment, publisher fraud, data incident) + pre-pilot gates in
  `docs/pilot-checklist.md`, with human-gated items honestly marked.
- **Deferred with notes**: app-handoff/device tests (manual).

## Integration notes (2026-09-22, phase 2 — money loop)

Four workstreams built in parallel against written contracts, then reconciled:

- **Money pipeline** (`api`, `redirect`, `workers`): `db/migrations/0002_money_loop.sql`
  adds `conversions.contract_version_id`, `merchant_settlements` (collected-cash
  pools), `payout_transfers` (fake-rail transfers), and the `payout_clearing`
  ledger account. Conversion state machine with `provider_revision` ordering
  (higher revision may advance received→pending→approved; never downgrades;
  approved→declined at higher revision becomes a reversal adjustment, never a
  status flip). Reversals via `POST /v1/integrations/{connector}/events` with
  `kind: 'reversal'`. Payout flow: prepare (return-window exclusion, collected
  pro-rata cap, threshold) → approve (maker-checker) → disburse → fake-rail
  callback → `paid`, posting Dr `publisher_liability` / Cr `payout_clearing`.
  Test seams: `__setPool()` in `packages/api/src/db.ts` (also covers
  idempotency), `buildRedirectApp()` in `packages/redirect/src/index.ts`,
  `buildApp()` in `packages/api/src/index.ts` (no listen on import).
- **pg-mem fidelity notes**: several pg-mem 3.x limitations are worked around
  in app code with real-Postgres-equivalent behavior (bare `ON CONFLICT DO
  NOTHING` at insert-if-absent sites with re-select, `IN (...)` expansion
  instead of `= ANY($array)`, JS-side timestamp normalisation, no LATERAL —
  earnings pending bucket is two queries + JS math). Revisit on real Postgres
  before pilot: restore targeted `ON CONFLICT (cols)` arbiters and confirm
  `unique nulls not distinct` semantics.
- **Seed + demo**: `pnpm seed` seeds a real Postgres (needs `DATABASE_URL`);
  `pnpm demo` runs the full money loop in-process on pg-mem (no Docker
  needed): link → click → webhook → 160→112/48 ledger → duplicate dedupe →
  50% reversal → 56/24 → settlement → prepare → 403 self-approve → approve →
  disburse → paid callback → liability 0. Demo contract threshold is INR 50
  (deliberately low so the INR 56 post-reversal earnings clear it; the
  threshold gate itself is covered by tests).
- **Tests**: `pnpm test` — vitest, 31 tests across ledger math, money-loop API
  (idempotency ×10, revision ordering, suspense, reversals, payout gates,
  maker-checker), and the provider-events worker. All green in this
  environment.
- **Web**: publisher portal (`/portal`, `/portal/links`, `/portal/statements`)
  and editorial console (`/console`, `/console/looks/[id]`) added (since
  2026-09-29 under `/app` and `/admin`; the old URLs redirect); live
  against `GET /v1/publisher/earnings` and `POST /v1/links` when
  `NEXT_PUBLIC_API_BASE` is reachable, labelled demo-data fallback otherwise.

## Integration notes (2026-09-22, foundation build)

Workstreams were built in parallel against a written contract and reconciled
afterwards. Decisions made at integration:

- `LedgerEntryDraft` / `buildConversionEntries` / `buildAdjustmentEntries`
  accept `publisher_id` and `memo` (mirrors `ledger_entries.publisher_id`;
  needed for per-publisher payout accounting).
- The temporary `src/shared-shim.d.ts` files in `packages/api` and
  `packages/redirect` were deleted once the real `@paparazzi/shared` landed.
  Shim-invented error codes were remapped to the contract's 12 codes:
  `INTERNAL_ERROR` → `INTERNAL`, `CONVERSION_PROGRAMME_UNKNOWN` and
  `PAYOUT_BELOW_THRESHOLD` → `VALIDATION_ERROR`, `INVALID_BATCH_STATE` →
  `CONFLICT`.
- `ConversionStatus` (domain/DB enum, includes `received`) and the
  connector-side enum collide by name; the barrel exports the latter as
  `ProviderConversionStatus`. A unified enum is a phase-2 decision.
- No Docker/Postgres/Redis exists in this build environment, so migrations
  were validated with pg-mem (all 31 tables created; `NULLS NOT DISTINCT`
  and the `pgcrypto` extension are real-Postgres-only and were shimmed in
  the harness, not the migration). `docker compose up -d` + `node
  db/migrate.mjs` remain the first thing to run on a dev machine.
- `pnpm` must be on PATH as `/usr/bin/pnpm` in non-interactive shells here;
  the npm-global shim is unreliable in this environment.
