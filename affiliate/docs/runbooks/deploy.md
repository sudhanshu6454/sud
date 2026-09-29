# Runbook: deploy & rollback

Dated 2026-09-23; revised 2026-09-29 for **afflino.com on the owner's
Linode** (single host: `docker-compose.prod.yml` +
`docker-compose.single-host.yml`, the edge terminating TLS). **Nothing has
been deployed to the Linode or to afflino.com from this repository yet**;
this is the procedure, and §1R is the rehearsal that was run locally.

Conventions for every command below: run as root on the Linode, from the
checkout's `affiliate/` directory. The paths are the ones the Linode
installer uses — checkout `/opt/afflino` (branch
`claude/nifty-pasteur-flrulw` of the public repository
`https://github.com/sudhanshu6454/sud`), environment file
`/etc/afflino/afflino.env` (root-owned, mode 0600, the variables of
`.env.prod.example`), seed output `/etc/afflino/seed-network.json`. Each
command is one complete line. Secrets are only ever read from the
environment file by compose: they are entered into it through hidden
prompts, never typed on a command line, never printed; the lines below that
need a token mint it inside a container and pass it through the environment
(`API_TOKEN=... docker compose ... -e API_TOKEN`) or stdin (`curl -H @-`),
never through a command-line argument. The server has bash, python3, curl,
git and docker only (no make, no node, no dig); node runs inside the
containers.

## 0. Preconditions (do not deploy without these)

- [ ] Release commit green: `pnpm typecheck`, `./node_modules/.bin/vitest run`
      (660 tests in 35 files on 2026-09-29), `pnpm demo`, `pnpm demo:pg`,
      the web build (CI workflow `afflino`).
- [ ] `docs/runbooks/dependency-review.md` re-run for the release; no
      unaddressed high/critical findings.
- [ ] **DNS** (GoDaddy, nameservers `ns01.domaincontrol.com`): the `A`
      record of `afflino.com` points at the Linode's IPv4 address, with
      GoDaddy's parking/forwarding removed (on 2026-09-29 the apex resolved
      to GoDaddy's 3.33.130.190 and 15.197.148.33); `www.afflino.com` stays a
      CNAME to `afflino.com`; **no AAAA record** (see "Client addresses and
      Docker" in `docker/README.md`). The edge asks Let's Encrypt for
      certificates for exactly `afflino.com` and `www.afflino.com` as soon as
      it starts and retries with backoff while DNS is not there yet. Check
      from the server with
      `curl -s 'https://dns.google/resolve?name=afflino.com&type=A'`.
- [ ] The Linode: 80/tcp, 443/tcp and 443/udp reachable (ufw allows OpenSSH,
      80, 443; Docker's published ports bypass ufw, which is why only the
      edge publishes publicly and api / redirect / web bind 127.0.0.1).
- [ ] `/etc/afflino/afflino.env` holds `POSTGRES_PASSWORD`, `JWT_SECRET`,
      `STUB_WEBHOOK_SECRET` and `IP_HASH_KEY` (`docs/credential-setup.md`
      "Single-host Linode"); `SITE_INDEXING` unset or `off`.
- [ ] A backup exists and restores (§5) — from the second deploy on.
- [ ] The release's migration files are reviewed (§2): append-only,
      forward-only.
- [ ] An operator and the seeded `network_admin` are available for the
      kill-switch drill (§4).

## 1. First deploy of afflino.com

1. **Bring the stack up** (builds the five images; migrate runs first and
   api, redirect and workers wait for it; the edge starts and fetches
   certificates). Without `WEB_API_TOKEN` the shop shows labelled TEST demo
   data, and with `SITE_INDEXING` off every page is noindex:
   ```sh
   docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d --build
   ```
2. **Seed the in-house network with the TEST programme** (`NODE_ENV` is unset
   in the migrate image, which is what `--with-demo-programme` needs; the
   shop's host defaults to `SITE_HOST`). Until a real programme is
   contracted this is the only way to a placement, so `WEB_PLACEMENT_ID`
   points at TEST rows — a sandbox shape, not a launch:
   ```sh
   docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm -T migrate ./node_modules/.bin/tsx db/seed-network.ts --with-demo-programme > /etc/afflino/seed-network.json
   ```
3. **Store the shop's placement and its read-only token** in the environment
   file (the token is minted inside the api container from `JWT_SECRET` and
   never printed):
   ```sh
   sed -i '/^WEB_PLACEMENT_ID=/d' /etc/afflino/afflino.env && echo "WEB_PLACEMENT_ID=$(grep -m1 '"web_placement_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" >> /etc/afflino/afflino.env
   sed -i '/^WEB_API_TOKEN=/d' /etc/afflino/afflino.env && echo "WEB_API_TOKEN=$(docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_analyst --sub web-shop --ttl 365d)" >> /etc/afflino/afflino.env
   ```
4. **Restart the web with them**:
   ```sh
   docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d web
   ```
5. **Mint the shop's links** (an owner token, minted in a container and
   handed over through the environment):
   ```sh
   API_TOKEN="$(docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_owner --sub network-owner)" docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T -e API_BASE=http://api:3000 -e API_TOKEN api node scripts/mint-links.mjs --placement "$(grep -m1 '"web_placement_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')"
   ```
   Expect `summary: looks=5 items=5 minted=1 ... failed=0` (one live TEST
   offer shared by the five looks).
6. **Verify** (each line prints what to compare):
   ```sh
   docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml ps
   curl -s http://127.0.0.1:3000/healthz; curl -s http://127.0.0.1:3001/healthz; curl -s http://127.0.0.1:3002/api/healthz; echo
   curl -s https://afflino.com/api/healthz; echo
   curl -s -D - -o /dev/null https://afflino.com/ | grep -i '^HTTP\|^strict-transport\|^x-content-type\|^referrer-policy\|^x-frame\|^server\|^via'
   curl -s -D - -o /dev/null 'https://www.afflino.com/shop?x=1' | grep -i '^HTTP\|^location'
   curl -s -D - -o /dev/null http://afflino.com/ | grep -i '^HTTP\|^location'
   curl -s https://afflino.com/robots.txt
   curl -s https://afflino.com/ | grep -o '<link rel="canonical" href="[^"]*"/>\|<meta name="robots" content="[^"]*"/>'
   curl -s "https://afflino.com/looks/$(grep -m1 '"look_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" | grep -o 'https://afflino.com/r/[0-9a-f]*' | head -1
   curl -s -D - -o /dev/null "$(curl -s "https://afflino.com/looks/$(grep -m1 '"look_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" | grep -o 'https://afflino.com/r/[0-9a-f]*' | head -1)" | grep -i '^HTTP\|^location\|^set-cookie'
   ```
   Expected: every service `running` / `healthy` (migrate `exited (0)`);
   `{"ok":true}` four times; `HTTP/2 200` with HSTS, nosniff,
   `strict-origin-when-cross-origin`, `DENY` and no `server` / `via` line;
   `www` → `301` to `https://afflino.com/shop?x=1`; plain HTTP → `308` to
   https; robots.txt `Disallow: /`; the canonical `https://afflino.com` and
   `noindex, nofollow`; a `https://afflino.com/r/<token>` link; and the link
   → `302` to `https://shop.example.com/...?subid=<click_id>` with no
   `set-cookie`.
7. **Kill-switch drill** (§4). A deploy is not done until it passes.
8. **Watch** for 15 minutes:
   `docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml logs -f --since 15m`
   (no `LEDGER_IMBALANCE`, the workers log `click.observed` for the clicks
   above; the edge logs certificate issuance for both names).

**Opening the site to search engines** is a separate, owner-only decision:
the public pages carry placeholder prices, fees, TDS figures and legal stubs
(`packages/web/lib/site-copy.ts`) and the only looks are TEST rows. When
those are replaced, set `SITE_INDEXING=on` in the environment file and run
the step-4 line again (a restart, not a rebuild); robots.txt then names
`https://afflino.com/sitemap.xml`.

**Own network file instead of the TEST example:** keep `network.yaml` next
to `docker-compose.prod.yml`, uncomment the `migrate` service's volume, set
`NETWORK_FILE=/app/config/network.yaml` in the environment file, and seed
with `-e NODE_ENV=production` (the seed then refuses the example file, so a
lost `NETWORK_FILE` fails instead of seeding the five TEST properties into the
real `afflino` organisation):

```sh
docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm -T -e NODE_ENV=production migrate ./node_modules/.bin/tsx db/seed-network.ts
```

## 1R. Rehearsal without DNS or certificates

The same stack with the edge in plain-HTTP test mode on 127.0.0.1:8088
(`docker-compose.edge-test.yml`), under a throwaway project name, with TEST
values given to each compose command (not a secrets file, and never
`export`ed: a variable in the shell overrides the environment file, so an
exported TEST value would leak into a later real deploy from the same
shell) — how the shape was verified on 2026-09-29 before any server
existed. It does not bind 80/443, and `down -v` removes its volumes.

```sh
IMAGE_TAG=test JWT_SECRET=test-jwt-secret-rehearsal-0123456789 STUB_WEBHOOK_SECRET=test-stub-secret POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef IP_HASH_KEY=e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0 docker compose -p afflino-rehearsal -f docker-compose.prod.yml -f docker-compose.single-host.yml -f docker-compose.edge-test.yml up -d
for i in $(seq 1 60); do curl -fs -o /dev/null -H 'Host: afflino.com' http://127.0.0.1:8088/api/healthz && break; sleep 2; done
curl -s -H 'Host: afflino.com' http://127.0.0.1:8088/ | grep -o '<link rel="canonical" href="[^"]*"/>\|<meta name="robots" content="[^"]*"/>'
curl -s -D - -o /dev/null -H 'Host: www.afflino.com' 'http://127.0.0.1:8088/shop?x=1' | grep -i '^HTTP\|^location'
```

and afterwards (after the optional HTTPS check below):

```sh
IMAGE_TAG=test JWT_SECRET=test-jwt-secret-rehearsal-0123456789 STUB_WEBHOOK_SECRET=test-stub-secret POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef IP_HASH_KEY=e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0 docker compose -p afflino-rehearsal -f docker-compose.prod.yml -f docker-compose.single-host.yml -f docker-compose.edge-test.yml down -v --remove-orphans
```

(`IMAGE_TAG=test` runs images built as `paparazzi/<svc>:test`; drop it, or
add `--build` to `up`, to build them.)

The HTTPS path of the same Caddyfile can be rehearsed too, with a name
Caddy issues from its own internal CA instead of Let's Encrypt (`.internal`
is never publicly issuable), attached to the rehearsal's network while it
is up:

```sh
docker run -d --name afflino-rehearsal-tls --network afflino-rehearsal_default -p 127.0.0.1:8480:80 -p 127.0.0.1:8443:443 -e SITE_HOST=afflino.internal -e ACME_EMAIL= -e "EDGE_ADDRESS=afflino.internal, www.afflino.internal" -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine
for i in $(seq 1 30); do curl --noproxy '*' -fsk -o /dev/null --resolve afflino.internal:8443:127.0.0.1 https://afflino.internal:8443/api/healthz && break; sleep 1; done
curl --noproxy '*' -sk -D - -o /dev/null --resolve afflino.internal:8443:127.0.0.1 https://afflino.internal:8443/ | grep -i '^HTTP\|^strict-transport\|^x-frame\|^server\|^alt-svc'
curl --noproxy '*' -sk -D - -o /dev/null --resolve www.afflino.internal:8443:127.0.0.1 'https://www.afflino.internal:8443/shop?x=1' | grep -i '^HTTP\|^location'
curl --noproxy '*' -s -D - -o /dev/null -H 'Host: afflino.internal' 'http://127.0.0.1:8480/shop?x=1' | grep -i '^HTTP\|^location'
curl --noproxy '*' -sk -o /dev/null -w 'unknown name: curl exit %{exitcode}\n' --resolve other.internal:8443:127.0.0.1 https://other.internal:8443/
docker rm -f afflino-rehearsal-tls
```

Observed 2026-09-29: `HTTP/2 200` with `alt-svc: h3=":443"`, HSTS,
`X-Frame-Options: DENY` and no `server` line; `www` → `HTTP/2 301` to
`https://afflino.internal/shop?x=1`; plain HTTP → `308 Permanent Redirect`
to the same; an unknown name (and a bare IP) → TLS handshake refused (curl
exit 35: no certificate exists for any other name); the served certificate's
SAN is `DNS:afflino.internal`; `/api/healthz` 200 and `/r/<unknown token>`
404 over HTTPS. The only difference on the Linode is the issuer (Let's
Encrypt, which needs the DNS change). The full rehearsal of 2026-09-29 —
the seed, both tokens, the web restart, mint-links, the look page's
`https://afflino.com/r/<token>`, the `302`, a spoofed `X-Forwarded-For`
leaving `ip_hash` = HMAC(`IP_HASH_KEY`, the address the edge saw), the
kill-switch atomicity check on real Postgres, both `SITE_INDEXING` states
and the teardown — is recorded in README.md "Deploying afflino.com".

## 1U. Routine deploy (update)

1. **Pin the release**: tag the commit (`release-YYYYMMDD-HHMM`); set
   `IMAGE_TAG` to it in the environment file (never deploy `latest` to the
   pilot once a release tag exists).
2. **Take a backup** (§5).
3. **Update and rebuild** (migrate runs before the services restart; if it
   fails, nothing else is recreated — fix forward, §2):
   ```sh
   cd /opt/afflino && git fetch origin && git merge --ff-only origin/claude/nifty-pasteur-flrulw && cd affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d --build --remove-orphans
   ```
4. **Verify** (§1 step 6), the drill (§4), and watch (§1 step 8).

## 2. Migration rollback policy

**Migrations in this repo are append-only and forward-only — there are no
down-migrations.** `db/migrate.mjs` records every applied file in
`schema_migrations` (filename, applied_at) inside the same transaction as
the file itself, and skips recorded files on the next run, so a re-deploy
is a no-op when nothing is pending. `node db/migrate.mjs --status` lists
applied and pending files. A database created before tracking existed is
recorded once with `node db/migrate.mjs --baseline` (only when its schema
is already current). Consequences:

- A **failed migration** leaves the database at the last fully-applied
  file (each file runs in its own transaction and rolls back on error).
  Do not partially re-run; do not hand-apply the missing statements.
- A **bad migration that applied cleanly** cannot be "rolled back" by
  the tooling. The only supported rollback is:
  1. Restore Postgres from the pre-deploy snapshot (point-in-time
     recovery per `docs/runbooks/backup-restore.md`).
  2. Redeploy the previous `IMAGE_TAG` (which contains the previous
     migration set).
  3. Write a **forward compensating migration** (new numbered file, e.g.
     `0005_*.sql`) that undoes the bad change's *effect* for any
     environments that already applied it — never edit or delete the
     shipped file.
- Because restores lose data written after the snapshot, prefer
  forward-fixes for anything that does not corrupt the ledger; reserve
  snapshot restore for corruption or a migration that blocks the app
  from booting.
- **Known gap:** `schema_migrations` records filenames, not checksums,
  so an edited shipped file would not be noticed. Never edit a shipped
  migration; write a new numbered file instead. A restored snapshot
  carries its own `schema_migrations` rows, so the runner applies exactly
  the files the snapshot predates.

## 3. Rollback procedure (bad release)

1. Note the current `IMAGE_TAG` and the failure symptom; open an incident
   channel.
2. If the failure is **code-only** (no migration applied in this
   release): check out the previous release tag and redeploy it (§1U tags
   every release `release-YYYYMMDD-HHMM`, so the second-newest tag is the
   one before this release; `--build` builds from the checkout, which is
   why the checkout comes first; set `IMAGE_TAG` in the environment file to
   that tag afterwards so the next `up` keeps it), then re-run the §1 step 6
   checks. No database action needed.
   ```sh
   cd /opt/afflino && git fetch --tags origin && PREV="$(git tag --list 'release-*' | sort | tail -n 2 | head -n 1)" && git checkout "$PREV" && cd affiliate && IMAGE_TAG="$PREV" docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d --build
   ```
   (A variable exported in the shell wins over the environment file, so
   `IMAGE_TAG="$PREV"` applies to that one command.) The checkout is now on
   a detached tag: `cd /opt/afflino && git checkout claude/nifty-pasteur-flrulw`
   before the next §1U deploy.
3. If the release **included a migration** that applied: follow the
   migration rollback policy above (forward compensating migration
   preferred; restore from the pre-deploy dump for corruption, §5).
4. If the redirect service is down but API/DB are up: pull the programme
   kill switch for affected programmes (`POST
   /v1/programmes/:id/pause`, `network_admin`) so links serve the paused
   page instead of silently dropping attribution — see
   `docs/runbooks/tracking-outage.md` § Immediate containment.
5. Postmortem within 48 h; record the rollback in the incident log with
   the tags involved.

## 4. Kill-switch drill procedure

Purpose: prove that pausing a programme stops commissionable traffic
end-to-end (eligibility flip + cache invalidation + blocked minting) and
that resume restores it. Run **after every deploy** and **monthly** in
pilot. Grounded in the tests at
`packages/api/test/phase3.test.ts` ("programme kill switch") — the drill is
the live version of that test. The status change, the `programme.paused` /
`programme.resumed` outbox event and the `audit_log` row commit in one
transaction, and the route cache is invalidated after the commit: a `500`
means nothing changed (tested: "a failing audit insert leaves the status
unchanged"; checked on real Postgres in the 2026-09-29 rehearsal).

Use a **canary programme** (TEST-labelled, never a real merchant
programme). Until a real programme exists the canary is the TEST "Demo
Network Programme" from the network seed; the lines below read its id, the
organisation's id and the seeded `network_admin` user's id from
`/etc/afflino/seed-network.json`, mint the token inside the api container,
and hand it to curl on stdin (`-H @-`), against the api on 127.0.0.1:3000.
The token's subject must be a `users` row: the audit row's `actor_id`
references `users`, so any other subject fails the call with a 500 and
changes nothing.

1. **Baseline:** the shop's link (§1 step 6) → **302** to the allow-listed
   host with `subid=` in the location.
2. **Pause** (as `network_admin`):
   ```sh
   echo "Authorization: Bearer $(docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role network_admin --sub "$(grep -A1 '"network_admin": {' /etc/afflino/seed-network.json | sed -n 's/.*"id": "\(.*\)".*/\1/p')")" | curl -fsS -X POST -H @- "http://127.0.0.1:3000/v1/programmes/$(grep -m1 '"programme_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')/pause"; echo
   ```
   Expect 200, `data.status == "paused"`, `redis_available: true`.
   (Pause is idempotent — re-pausing returns 200; the test asserts this.)
3. **Verify the kill:**
   - The shop's link → **200** with the paused page (no 302, no click
     minted, no `subid`).
   - `POST /v1/links` for the canary programme → **403**
     `PROGRAMME_NOT_APPROVED`.
   - The audit trail: an `audit_log` row `programme.pause` and an `outbox`
     event `programme.paused`:
     `docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select action, entity_id, created_at from audit_log order by created_at desc limit 2"'`
4. **Resume** (as `network_admin`):
   ```sh
   echo "Authorization: Bearer $(docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role network_admin --sub "$(grep -A1 '"network_admin": {' /etc/afflino/seed-network.json | sed -n 's/.*"id": "\(.*\)".*/\1/p')")" | curl -fsS -X POST -H @- "http://127.0.0.1:3000/v1/programmes/$(grep -m1 '"programme_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')/resume"; echo
   ```
   Expect 200, `data.status == "active"`. (Resuming a non-paused
   programme is 409 — the drill uses a paused one.)
5. **Verify recovery:** the shop's link → **302** with `subid=` again;
   mint a new link → 201.
6. **Negative control:** attempt pause as a non-admin role (`editor`)
   → expect **403** `FORBIDDEN` (the line prints the status code). If this
   ever returns 200, stop the drill and treat it as a security incident.
   ```sh
   echo "Authorization: Bearer $(docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role editor --sub "$(grep -A1 '"network_admin": {' /etc/afflino/seed-network.json | sed -n 's/.*"id": "\(.*\)".*/\1/p')")" | curl -s -o /dev/null -w '%{http_code}\n' -X POST -H @- "http://127.0.0.1:3000/v1/programmes/$(grep -m1 '"programme_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')/pause"
   ```
7. Log the drill (date, operator, programme id, all six outcomes) in the
   ops log. Any step failing = deploy is not accepted; roll back per §3.

## 5. Backups on the single host

Postgres runs in the `postgres` container with no published port and the
server has no Postgres client, so `scripts/backup.sh` (which runs `pg_dump`
on the host) does not apply as-is; a custom-format dump from inside the
container does (one line; the directory must exist, `mkdir -p
/var/backups/afflino` once):

```sh
docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "/var/backups/afflino/afflino-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

A dump on the same disk is not a backup: copy it off the server, schedule
it (before the 03:00 UTC retention purge), and prove it with a restore into
a scratch database (`docs/runbooks/backup-restore.md`) before real money
flows. The Redis append-only file (`redisdata` volume) keeps queued jobs
across a restart; it is not backed up, so jobs in flight when the disk is
lost are lost — the clicks, outbox rows and ledger themselves are Postgres
rows, which is what the dump protects. `docker compose ... down -v` deletes `pgdata`,
`redisdata` and the certificates in `caddy_data` — never run it on the
Linode.

## PENDING (production-only, cannot be checked in the sandbox)

- A real certificate issuance on afflino.com (needs the DNS change) and
  the §1 step 6 checks over the internet.
- A restore drill of a single-host dump on the Linode (validates §2 and §5
  end to end).
- Off-server copies of the dumps and their schedule.
- Checksums in `schema_migrations` (filenames are tracked; content is not).
- CI gate running `pnpm audit`, typecheck, tests, and the load soak
  (`pnpm load:smoke`) on every release candidate.
