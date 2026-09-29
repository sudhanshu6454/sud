# Runbook: deploy & rollback

Dated 2026-09-23; revised 2026-09-29 for **afflino.com on the owner's
Linode**: one command, `deploy/linode/install.sh`, installs the whole single
host (`docker-compose.prod.yml` + `docker-compose.single-host.yml`, the edge
terminating TLS) and, run again, updates it. **Nothing has been deployed to
the Linode or to afflino.com from this repository yet**; the installer was
rehearsed in the sandbox (`deploy/linode/README.md` "What was checked"), §1R
is the stack rehearsal.

Conventions for every command below: run as root on the Linode. Each command
is one complete line with nothing to fill in. The paths are the installer's:
checkout `/opt/afflino` (a sparse checkout of `affiliate/` from branch
`claude/nifty-pasteur-flrulw` of the public repository
`https://github.com/sudhanshu6454/sud`), environment file
`/etc/afflino/afflino.env` (root-owned, mode 0600, outside the checkout),
backups `/var/backups/afflino`, compose project `afflino` (containers
`afflino-<service>-1`). Secrets are generated on the server by the
installer and only ever read from the environment file by compose: never
typed on a command line, never printed; the lines below that need a token
mint it inside a container and pass it through the environment (`API_TOKEN=...
docker compose ... -e API_TOKEN`) or stdin (`curl -H @-`), never through a
command-line argument. Lines that start with `docker compose` run from
the checkout's `affiliate/` directory (`cd /opt/afflino/affiliate` once per
login). The server has bash, python3, curl, git and docker only (no make, no
node, no dig); node runs inside the containers. Never edit files inside
`/opt/afflino`: the installer refuses to update a checkout with local
changes (settings belong in the environment file).

## 0. Preconditions

- [ ] A Linode **dedicated to Afflino** (the owner reported "linode is
      ready" on 2026-09-29; its address, plan, region and image were not
      stated). Recommended: Ubuntu 24.04 LTS, region Mumbai (ap-west), the
      4 GB plan (see §6 for the sizing caveat). The installer refuses a
      server that already runs other Docker compose projects.
- [ ] The release commit is green in CI (workflow `afflino`: typecheck,
      vitest — 669 tests in 35 files on 2026-09-29 — both demos, the web
      build, compose config, ShellCheck on `deploy/linode/*.sh`).
- [ ] `docs/runbooks/dependency-review.md` re-run for the release; no
      unaddressed high/critical findings.
- [ ] **DNS** (GoDaddy, nameservers `ns01`/`ns02.domaincontrol.com`): `A @`
      = the Linode's IPv4 (every other `A @` removed), `AAAA @` = the
      Linode's IPv6, `CNAME www` → `@` kept, GoDaddy domain forwarding off
      (§1 step 3). The installer prints the exact values. Observed from
      outside: at 15:19 UTC on 2026-09-29 the apex resolved to GoDaddy's
      parking addresses 3.33.130.190 and 15.197.148.33; from 16:34 UTC the
      same day to **172.105.52.150** only, the owner's Afflino Linode (the
      owner's word), with no AAAA and `www` a CNAME to the apex. The owner
      ran §1 that day, and at 17:20 UTC afflino.com answered over HTTPS.
- [ ] From the second deploy on: a backup exists and its restore check
      passes (§5).
- [ ] The release's migration files are reviewed (§2): append-only,
      forward-only.

## 1. First deploy of afflino.com

1. **Log in to the Linode as root**: `ssh root@afflino.com` once the `A`
   record points at it, or Linode Cloud Manager → the Linode → **Launch
   LISH Console**.
2. **Run the installer** (the first image build takes several minutes;
   not yet timed on a Linode):
   ```sh
   bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
   ```
   What it does, in order (details: `deploy/linode/README.md` and the
   script's header):
   - **Preflight**: root; Ubuntu 24.04 / 22.04 or Debian 12, anything else
     refused; a server of its own: refuses a machine that already runs
     other Docker compose projects, and ports 80/443 (or 127.0.0.1:
     3000–3002) held by anything but Afflino's own stack; warns under 2 GB
     of RAM and adds a 2 GB swapfile (`/swapfile-afflino`) under 4 GB of RAM
     when there is less than 1 GB of swap (Linode images ship a 512 MB swap
     disk; the web image build needs the memory).
   - **System**: `ca-certificates curl git ufw fail2ban python3-systemd
     unattended-upgrades openssl iproute2 python3 gzip`; Docker from
     get.docker.com only when it is missing; ufw allows OpenSSH (and any
     other port sshd listens on) **first**, then 80/tcp, 443/tcp, 443/udp,
     and is enabled; fail2ban's sshd jail (journal backend); automatic
     security updates (`/etc/apt/apt.conf.d/20auto-upgrades`); larger UDP
     buffers for HTTP/3.
   - **Code**: clones the branch into `/opt/afflino` (sparse: `affiliate/`
     only), or fetches and fast-forwards it, keeping the release that ran
     before as the git tag `afflino-previous` (§3) and noting it in
     `/etc/afflino/previous-release`; stops, changing nothing, when the
     checkout has local changes, local commits or is not on the branch.
     The rest of the run is the checkout's own copy of the installer (the
     line runs whatever raw.githubusercontent.com served, cached for up to
     5 minutes after a push).
   - **Environment**: creates `/etc/afflino/afflino.env` (root:root 0600)
     with `POSTGRES_PASSWORD`, `JWT_SECRET`, `STUB_WEBHOOK_SECRET` and
     `IP_HASH_KEY` generated by openssl and never printed, `SITE_HOST=
     afflino.com`, `SITE_INDEXING=off`, and `ACME_EMAIL` — the only
     question: an optional address for the Let's Encrypt account (account
     and policy notices only; Let's Encrypt sends no expiry emails, and the
     edge renews by itself; Enter skips it). Later runs keep every value and
     only add keys that are missing.
   - **Deploy**: `docker compose` (project `afflino`, both files) `build`,
     then the migrations on their own (`run --rm migrate`: if they fail,
     it stops there and the running services are not touched), then `up
     -d --remove-orphans`; waits for api, redirect and web to be healthy;
     checks the edge answers.
   - **Status**: the services, the three health checks, the server's IPv4
     and IPv6 (from its interfaces), whether afflino.com and
     www.afflino.com resolve to it, the exact DNS records to set if not,
     and whether HTTPS already works.
   - **Backups**: `afflino-backup.timer` (daily 02:30 UTC, `backup.sh`,
     14 kept) and a first backup.
3. **DNS at GoDaddy**, if the status says "NOT this server yet". By hand:
   GoDaddy → My Products → afflino.com → **DNS** → DNS Records:
   - `A` record, name `@`: edit it to the Linode's IPv4 address, and delete
     every other `A` record named `@` (GoDaddy's parking addresses were
     3.33.130.190 and 15.197.148.33).
   - `AAAA` record, name `@`: add it with the Linode's IPv6 address (the
     one the status prints; Cloud Manager → the Linode → Network shows it
     too).
   - `CNAME` record, name `www`, value `@`: keep it.
   - GoDaddy → afflino.com → **Forwarding**: if domain forwarding is set up,
     delete it (it keeps GoDaddy's own `A` records in place).

   Or, only for GoDaddy accounts with API access (GoDaddy grants it to
   accounts with 10 or more domains or a Discount Domain Club plan), from
   the Linode, with credentials from developer.godaddy.com entered at two
   hidden prompts and never stored: a personal access token with the DNS
   scope (press Enter at the second, "API secret", prompt), or an API key
   (Production) and its secret:
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/godaddy-dns.sh
   ```
   It sets `A @` and `AAAA @` to this server, keeps the `www` CNAME, prints
   before / after, and stops with the reason on 401 (wrong, expired or OTE
   credentials), 403 (no API access for the account, or the token lacks the
   domains/DNS scope — create a personal access token with the DNS scope on
   developer.godaddy.com, or set the records by hand), 404 or 422.

   IPv6 is safe to publish: the edge runs with host networking, so it sees
   every client's real address over IPv4 and IPv6 (a Docker-published port
   would give every IPv6 client the compose network's gateway address,
   which is why an AAAA record was not recommended before the edge moved
   to host networking).
4. **Certificates** are automatic: the edge requests them from Let's Encrypt
   for exactly afflino.com and www.afflino.com and retries until DNS points
   at the server. Check DNS from the server and watch the edge:
   ```sh
   getent ahosts afflino.com
   docker logs -f afflino-edge-1 2>&1 | grep -i certificate
   ```
   Then run the installer line again: its status then reads "A points here"
   and "HTTPS: https://afflino.com answers here with a valid certificate".
5. **Verify** (each line prints what to compare):
   ```sh
   cd /opt/afflino/affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml ps
   curl -s http://127.0.0.1:3000/healthz; curl -s http://127.0.0.1:3001/healthz; curl -s http://127.0.0.1:3002/api/healthz; echo
   curl -s https://afflino.com/api/healthz; echo
   curl -s -D - -o /dev/null https://afflino.com/ | grep -i '^HTTP\|^strict-transport\|^x-content-type\|^referrer-policy\|^x-frame\|^server\|^via'
   curl -s -D - -o /dev/null 'https://www.afflino.com/shop?x=1' | grep -i '^HTTP\|^location'
   curl -s -D - -o /dev/null http://afflino.com/ | grep -i '^HTTP\|^location'
   curl -s https://afflino.com/robots.txt
   curl -s https://afflino.com/ | grep -o '<link rel="canonical" href="[^"]*"/>\|<meta name="robots" content="[^"]*"/>'
   ```
   Expected: every service `running` / `healthy` (migrate `exited (0)`);
   `{"ok":true}` four times; `HTTP/2 200` with HSTS, nosniff,
   `strict-origin-when-cross-origin`, `DENY` and no `server` / `via` line;
   `www` → `301` to `https://afflino.com/shop?x=1`; plain HTTP → `308` to
   https (Caddy's own redirect on port 80, which carries `server: Caddy`
   and no HSTS; every HTTPS response, the edge's own 502 / 413 included,
   carries the headers); robots.txt `Disallow: /`; the canonical
   `https://afflino.com` and `noindex, nofollow`. The site then shows the
   marketing pages with the owner's confirmed figures and a shop of
   labelled TEST demo looks (no API call is made for them).
6. **Optional: tracked links with the TEST programme.** Until a real
   merchant programme is contracted, the only way to exercise
   `https://afflino.com/r/<token>` (and the kill-switch drill, §4) is the
   network seed's TEST programme (`--with-demo-programme`: six "Demo …"
   properties on `example.com` names, "Demo Network Programme",
   `shop.example.com`). It writes TEST rows into the live database — a
   sandbox shape, not a launch — into the same `afflino` organisation as
   the owner's real accounts, so **skip it once the in-house network is
   seeded** (below, "The in-house network"); rehearse it with §1R instead. The lines (`NODE_ENV` is unset in the
   migrate image, which the flag needs; the shop's host defaults to
   `SITE_HOST`), from `/opt/afflino/affiliate`:
   a. **Seed the in-house network with the TEST programme**:
   ```sh
   docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm -T migrate ./node_modules/.bin/tsx db/seed-network.ts --with-demo-programme > /etc/afflino/seed-network.json
   ```
   b. **Store the shop's placement and its read-only token** in the environment
   file (the token is minted inside the api container from `JWT_SECRET` and
   never printed):
   ```sh
   sed -i '/^WEB_PLACEMENT_ID=/d' /etc/afflino/afflino.env && echo "WEB_PLACEMENT_ID=$(grep -m1 '"web_placement_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" >> /etc/afflino/afflino.env
   sed -i '/^WEB_API_TOKEN=/d' /etc/afflino/afflino.env && echo "WEB_API_TOKEN=$(docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_analyst --sub web-shop --ttl 365d)" >> /etc/afflino/afflino.env
   ```
   c. **Restart the web with them**:
   ```sh
   docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d web
   ```
   d. **Mint the shop's links** (an owner token, minted in a container and
   handed over through the environment):
   ```sh
   API_TOKEN="$(docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_owner --sub network-owner)" docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm --no-deps -T -e API_BASE=http://api:3000 -e API_TOKEN api node scripts/mint-links.mjs --placement "$(grep -m1 '"web_placement_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')"
   ```
   Expect `summary: looks=6 items=6 minted=1 ... failed=0` (one live TEST
   offer shared by the six looks).
   Then the look page carries the tracked link, and the link → `302` to
   `https://shop.example.com/...?subid=<click_id>` with no `set-cookie`:
   ```sh
   curl -s "https://afflino.com/looks/$(grep -m1 '"look_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" | grep -o 'https://afflino.com/r/[0-9a-f]*' | head -1
   curl -s -D - -o /dev/null "$(curl -s "https://afflino.com/looks/$(grep -m1 '"look_id"' /etc/afflino/seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" | grep -o 'https://afflino.com/r/[0-9a-f]*' | head -1)" | grep -i '^HTTP\|^location\|^set-cookie'
   ```
   The installer never runs these lines and later runs keep
   `WEB_API_TOKEN` / `WEB_PLACEMENT_ID` in the environment file.
7. **Kill-switch drill** (§4, needs step 6). A deploy of real traffic is not
   done until it passes.
8. **Watch** for 15 minutes (no `LEDGER_IMBALANCE`; the edge logs the
   certificate issuance for both names):
   ```sh
   cd /opt/afflino/affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml logs -f --since 15m
   ```

**Opening the site to search engines** is a separate, owner-only decision.
The figures (`packages/web/lib/site-copy.ts`) are confirmed (2026-09-29);
the terms, privacy and contact pages are still stubs, and the only looks
are TEST rows (their pages stay `noindex, nofollow`). One line switches it
on (the web restarts; nothing is rebuilt):
```sh
sed -i 's/^SITE_INDEXING=.*/SITE_INDEXING=on/' /etc/afflino/afflino.env && bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
```
robots.txt then allows the public pages and names
`https://afflino.com/sitemap.xml` (`/`, `/shop` and the live, non-TEST
looks; the look pages of TEST and demo looks stay `noindex, nofollow`). The
same line with `off` closes it again.

**The in-house network (your own accounts) instead of the TEST example.**
The network file lists the owner's own accounts (format:
`db/network.example.yaml`; Facebook pages by numeric page ID, the other
platforms by handle). It is not in the repository: it lives on the server
as `/etc/afflino/network.yaml`, outside the checkout, so updates keep
working. It is built on the server from the owner's Meta channel exports
(`meta-channels-28d-<platform>-<date>.csv`) by `db/meta-network.ts`, which
checks the result with the seed's own rules before writing it. The seed
then runs with `NODE_ENV=production`, which refuses the TEST example, so a
line that lost the file fails instead of seeding TEST rows into the real
`afflino` organisation.

1. On the Linode, update first (the converter ships with the code):
   ```sh
   bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
   ```
2. On your Mac, copy the newest Facebook and Instagram exports to the
   server (Spotlight finds them wherever they are saved; they land in
   `/etc/afflino/meta/` as `facebook.csv` and `instagram.csv`):
   ```sh
   ssh root@afflino.com 'mkdir -p /etc/afflino/meta' && for p in facebook instagram; do f=$(mdfind -name "meta-channels-28d-$p" 2>/dev/null | grep -E '\.csv$' | awk -F/ '{print $NF "\t" $0}' | sort | tail -1 | cut -f2-); if [ -n "$f" ]; then echo "copying $f"; scp "$f" "root@afflino.com:/etc/afflino/meta/$p.csv"; else echo "no $p export found on this Mac"; fi; done
   ```
3. On the Linode, build the network file from them and seed it:
   ```sh
   chmod -R a+rX /etc/afflino/meta && cd /opt/afflino/affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm -T -v /etc/afflino/meta:/app/config/meta:ro migrate ./node_modules/.bin/tsx db/meta-network.ts /app/config/meta > /etc/afflino/network.yaml.new && mv /etc/afflino/network.yaml.new /etc/afflino/network.yaml && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm -T -v /etc/afflino/network.yaml:/app/config/network.yaml:ro -e NETWORK_FILE=/app/config/network.yaml -e NODE_ENV=production migrate ./node_modules/.bin/tsx db/seed-network.ts > /etc/afflino/network-seed.json
   ```
   Expect `meta-network: <N> properties (facebook …, instagram …) from 2
   file(s)`, then `seed-network: <N> properties from
   /app/config/network.yaml, shop host afflino.com`, three warnings and one
   line "… and <N−3> more like these" (every real url warns once: the seed
   cannot verify an account), and the note that there is no
   `web_placement_id` until a real programme is contracted.
   `/etc/afflino/network-seed.json` holds every id. A failed conversion
   leaves the previous `network.yaml` in place and seeds nothing. The
   `chmod` lets the migrate container (user `node`, uid 1000) read the
   exports: scp keeps the Mac file's mode, which can be owner-only.

With a network file you already have, copy it to
`/etc/afflino/network.yaml` instead of steps 2–3 (from your Mac:
`scp afflino-network.yaml root@afflino.com:/etc/afflino/network.yaml`, in
the folder that holds it) and seed it on the Linode:
```sh
chmod a+r /etc/afflino/network.yaml && cd /opt/afflino/affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml run --rm -T -v /etc/afflino/network.yaml:/app/config/network.yaml:ro -e NETWORK_FILE=/app/config/network.yaml -e NODE_ENV=production migrate ./node_modules/.bin/tsx db/seed-network.ts > /etc/afflino/network-seed.json
```

Re-running steps 2–3 with the same exports changes nothing. Newer exports
add new accounts; an account missing from them stays in the database (the
seed never deletes). Snapchat and YouTube rows are not converted yet (the
converter says so); add those accounts to the file by hand or send their
exports to be supported. Registering the accounts changes nothing on the
public site: the properties earn only once a merchant programme exists and
tracked links are minted for them. Rehearsed on 2026-09-29 with the
owner's Meta exports (322 Facebook pages, 82 Instagram accounts), on a
scratch Postgres 16 database and on the installer's stack in test mode:
404 approved properties plus the shop's own, twice, with identical output.

## 1R. Rehearsal without DNS or certificates

The same stack with the edge in plain-HTTP test mode on 127.0.0.1:8088
(`docker-compose.edge-test.yml`), under a throwaway project name, with TEST
values given to each compose command (not a secrets file, and never
`export`ed: a variable in the shell overrides the environment file, so an
exported TEST value would leak into a later real deploy from the same
shell) — how the shape was verified on 2026-09-29 before any server
existed. It does not bind 80/443 (the edge, host-networked as in
production, listens on 127.0.0.1:8088 only), and `down -v` removes its
volumes. The installer itself was rehearsed the same way, with its
test-only settings (`deploy/linode/README.md` "What was checked").

```sh
IMAGE_TAG=test JWT_SECRET=test-jwt-secret-rehearsal-0123456789 STUB_WEBHOOK_SECRET=test-stub-secret POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef IP_HASH_KEY=e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0 docker compose -p afflino-rehearsal -f docker-compose.prod.yml -f docker-compose.single-host.yml -f docker-compose.edge-test.yml up -d
for i in $(seq 1 60); do curl -fs -o /dev/null -H 'Host: afflino.com' http://127.0.0.1:8088/api/healthz && break; sleep 2; done
curl -s -H 'Host: afflino.com' http://127.0.0.1:8088/ | grep -o '<link rel="canonical" href="[^"]*"/>\|<meta name="robots" content="[^"]*"/>'
curl -s -D - -o /dev/null -H 'Host: www.afflino.com' 'http://127.0.0.1:8088/shop?x=1' | grep -i '^HTTP\|^location'
IMAGE_TAG=test JWT_SECRET=test-jwt-secret-rehearsal-0123456789 STUB_WEBHOOK_SECRET=test-stub-secret POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef IP_HASH_KEY=e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0 docker compose -p afflino-rehearsal -f docker-compose.prod.yml -f docker-compose.single-host.yml -f docker-compose.edge-test.yml stop web
curl -s -D - -H 'Host: afflino.com' http://127.0.0.1:8088/ | grep -i '^HTTP\|^strict-transport\|^x-content-type\|^referrer-policy\|^x-frame\|^server\|^via\|^502'
IMAGE_TAG=test JWT_SECRET=test-jwt-secret-rehearsal-0123456789 STUB_WEBHOOK_SECRET=test-stub-secret POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef IP_HASH_KEY=e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0 docker compose -p afflino-rehearsal -f docker-compose.prod.yml -f docker-compose.single-host.yml -f docker-compose.edge-test.yml start web
```

The middle three lines are the upstream-down probe: with the web stopped the
edge answers `HTTP/1.1 502 Bad Gateway` with a `502 Bad Gateway` body, HSTS,
nosniff, Referrer-Policy and `X-Frame-Options: DENY`, and no `Server` or
`Via` line (the edge's own errors go through `handle_errors` in
`docker/Caddyfile`); `start web` brings it back.

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

The update is the install line, run again as root on the Linode:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
```

It fetches and fast-forwards `/opt/afflino` (stopping, with nothing
changed, if the checkout has local edits or commits), moves the local git
tag `afflino-previous` to the release that ran until now (the rollback
point, §3; also written to `/etc/afflino/previous-release`), continues
with the checkout's own copy of the installer, keeps every value in
`/etc/afflino/afflino.env` and adds only missing keys, **takes a backup
first** when the code or the environment file changed
(`afflino-<time>-pre-update.sql.gz`), rebuilds the images, runs the
migrations on their own before anything is recreated (if they fail it
stops there: api, redirect, workers and web keep running the release
before — fix forward, §2; rehearsed with a failing migrate command in the
sandbox), then starts the stack, restarts the edge only if its Caddyfile
changed, and waits for health. When nothing changed it changes nothing
(the same image ids, no container recreated; checked in the sandbox).
Then: verify (§1 step 5), the drill (§4) when step 6 was done, and watch
(§1 step 8).

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
  2. Redeploy the previous release (§3 step 2, the `afflino-previous`
     tag), which contains the previous migration set.
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

1. Note the current release (`git -C /opt/afflino log -1 --oneline`) and
   the failure symptom; open an incident channel.
2. If the failure is **code-only** (no migration applied in this
   release): go back to the release that ran before the last update. The
   installer keeps it as the local git tag `afflino-previous` (it moves the
   tag at every update that changes the code; `cat
   /etc/afflino/previous-release` shows which commit and when). The line
   checks it out and rebuilds the images from it (`--build` builds from the
   checkout, which is why the checkout comes first; the images keep the
   `latest` tag, so any later `docker compose ... up` keeps the rolled-back
   release), then re-run the §1 step 5 checks. No database action needed.
   ```sh
   cd /opt/afflino && git checkout afflino-previous && cd affiliate && docker compose --env-file /etc/afflino/afflino.env -f docker-compose.prod.yml -f docker-compose.single-host.yml up -d --build
   ```
   The checkout is now on a detached commit, so the installer refuses to
   update it (and says so) until the fix is released; then return to the
   branch and update in one line:
   ```sh
   cd /opt/afflino && git checkout claude/nifty-pasteur-flrulw && bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
   ```
   The tag exists from the first update after the install on; before any
   update there is no earlier release to go back to.
3. If the release **included a migration** that applied: follow the
   migration rollback policy above (forward compensating migration
   preferred; restore from the pre-deploy dump for corruption, §5).
4. If the redirect service is down but API/DB are up: pull the programme
   kill switch for affected programmes (`POST
   /v1/programmes/:id/pause`, `network_admin`) so links serve the paused
   page instead of silently dropping attribution — see
   `docs/runbooks/tracking-outage.md` § Immediate containment.
5. Postmortem within 48 h; record the rollback in the incident log with
   the commits involved.

## 4. Kill-switch drill procedure

Purpose: prove that pausing a programme stops commissionable traffic
end-to-end (eligibility flip + cache invalidation + blocked minting) and
that resume restores it. Run **after every deploy** and **monthly** in
pilot. Grounded in the tests at
`packages/api/test/phase3.test.ts` ("programme kill switch") — the drill is
the live version of that test. The status change, the `programme.paused` /
`programme.resumed` outbox event and the `audit_log` row commit in one
transaction, and the route cache is invalidated after the commit (and
once more 2 s later, for a redirect that was mid-read at the commit): a `500`
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

## 5. Backups and restore on the single host

Postgres runs in the `postgres` container with no published port and the
server has no Postgres client, so `scripts/backup.sh` / `scripts/restore.sh`
(which run `pg_dump` / `psql` on the host) do not apply there; the Linode
uses `deploy/linode/backup.sh` and `restore.sh`, which run them inside the
container.

- **Daily**: `afflino-backup.timer` (installed by the installer) runs
  `backup.sh daily` at 02:30 UTC (before the workers' 03:00 UTC retention
  purge): a plain SQL `pg_dump`, gzip, mode 0600, in `/var/backups/afflino`,
  checked (gzip test + pg_dump's closing line) before it is kept; the 14
  newest of each kind (daily, pre-update, pre-restore, manual) are kept.
- **Lines**:
  ```sh
  systemctl list-timers afflino-backup.timer
  bash /opt/afflino/affiliate/deploy/linode/backup.sh manual
  ls -l /var/backups/afflino
  bash /opt/afflino/affiliate/deploy/linode/restore.sh
  bash /opt/afflino/affiliate/deploy/linode/restore.sh --replace-live
  ```
  The fourth is the **restore check**: the newest dump restored into a
  scratch database (`afflino_restore_check`) in the same container,
  checked — migrations recorded, the tables present, row counts, the ledger
  balanced per currency (debits = credits in integer minor units) — and
  dropped; the live database is not touched. Run it after the first real
  money and monthly. The fifth **replaces the live database** with the
  newest dump (or a file named after the flag): it asks you to type
  `REPLACE`, takes a pre-restore backup, loads the dump into a staging
  database while the site keeps running (a dump that does not load stops
  here, the live database untouched), then stops web, api, redirect and
  workers for the few seconds of the swap (the edge answers 502 meanwhile,
  with its security headers), clears the redirect's route cache in Redis
  (`route:*`, which would otherwise keep the replaced database's link and
  programme state for up to 10 minutes: a programme paused in the dump
  could still redirect) and starts them again. Queued Redis jobs from
  before the swap (click events, outbox relays, provider events) are kept:
  any that refer to rows the dump does not have fail in the workers (their
  log shows it) and nothing is posted for them. Everything written after
  the dump is lost: use it for a lost or corrupted database, not to undo a
  release (§2, §3).
- **Off the server**: a dump on the same disk is not a backup. From the
  owner's own computer (with afflino.com pointing at the Linode):
  ```sh
  scp -r root@afflino.com:/var/backups/afflino .
  ```
  and/or Linode Backups (§6), which also covers `/etc/afflino/afflino.env`
  (the dumps do not: keep `IP_HASH_KEY` and `JWT_SECRET` with the data they
  belong to).
- The Redis append-only file (`afflino_redisdata`) keeps queued jobs across
  a restart; it is not backed up, so jobs in flight when the disk is lost
  are lost — the clicks, outbox rows and ledger are Postgres rows, which is
  what the dump protects.
- `docker compose ... down -v` deletes `afflino_pgdata`, `afflino_redisdata`
  and the certificates in `afflino_caddy_data` — **never run it on the
  Linode**. Changing `POSTGRES_PASSWORD` in the environment file later does
  nothing to the existing database (the password is set when the volume is
  first created).

## 6. Owner actions in Linode Cloud Manager (optional, recommended)

- **Cloud Firewall** (Networking → Firewalls → Create Firewall, then assign
  it to the Afflino Linode): inbound policy **Drop**; inbound rules Accept
  TCP 22, TCP 80, TCP 443 and UDP 443, IPv4 and IPv6; outbound **Accept**.
  It filters before traffic reaches the server, so it holds even for
  anything Docker publishes (Docker's published ports bypass ufw; only the
  edge listens publicly, api / redirect / web publish on 127.0.0.1).
  Keep TCP 22 in it, or SSH is cut off (LISH still works).
- **Linode Backups** (the Linode → Backups → Enable; a paid add-on): daily
  and weekly snapshots of the whole disk, including the environment file
  and the dumps.
- **Plan**: the 4 GB shared plan is the recommendation. Sizing for Afflino's real traffic is **unmeasured**: the
  seven long-running containers used about 166 MiB together at idle in the
  2026-09-29 rehearsal (no load), building the web image needs noticeably
  more for a minute or two (the installer adds swap on plans under 4 GB),
  and the load soak has never run on real infrastructure
  (`docs/capacity-plan.md`). Resize in Cloud Manager when the numbers say
  so; nothing in the stack depends on the plan.

## 7. What stays demo on the live site, and what is still pre-launch

On afflino.com after the install, honestly labelled:
- **No merchant programme exists.** The shop shows labelled TEST demo looks
  ("Demo data" badge) from the web's own demo data until a real network
  file and a real programme exist; with §1 step 6 it shows the network
  seed's TEST looks, whose links go to `shop.example.com`.
- **Stub authentication**: `/login` is a paste-a-token dev page for the JWT
  stub; there are no accounts, no OTP (`/join`'s OTP accepts any 6 digits),
  no KYC / PAN check. Tokens can only be minted on the server (they need
  `JWT_SECRET`).
- **Stub payout rail**: no money moves (`packages/api/src/payout-rail.ts`).
- The public figures (prices, fees, TDS, the validation window, the minimum
  withdrawal) are the owner's, confirmed 2026-09-29
  (`packages/web/lib/site-copy.ts`). The #ad line's wording waits for
  counsel, and the terms / privacy / contact pages are stubs.
  `SITE_INDEXING` stays `off` until the owner turns it on.
- The app areas (`/app`, `/brand`, `/agency`, `/admin`) are demo flows
  wherever no v1 endpoint exists, each with the "Demo data" badge.

Still open before real traffic (`docs/pilot-checklist.md`, the gates with
owners in `docs/action-tracker.md`): a real identity provider; webhook
signature verification; rate limiting (none on `/r/{token}`, the API or the
edge); a Content-Security-Policy; monitoring and alerts; off-server backups
and a restore drill on the server; the load soak; counsel's decisions
(retention windows, the keyed IP hash under DPDP, hosting jurisdiction);
contracted merchant programmes and a real payout rail.

## PENDING (production-only, cannot be checked in the sandbox)

- The installer on the real Linode: Docker from get.docker.com, ufw,
  fail2ban and the backup timer under systemd, the swapfile (all rehearsed
  in containers or skipped in the sandbox; `deploy/linode/README.md`).
- A real certificate issuance on afflino.com (needs the DNS change) and the
  §1 step 5 checks over the internet, over IPv4 and IPv6.
- `godaddy-dns.sh` against GoDaddy's real API (rehearsed against a local
  stand-in only).
- A restore check and a `--replace-live` drill of a single-host dump on the
  Linode (validates §2 and §5 end to end).
- Off-server copies of the dumps and their schedule.
- Checksums in `schema_migrations` (filenames are tracked; content is not).
- CI gate running `pnpm audit` and the load soak (`pnpm load:smoke`) on
  every release candidate.
