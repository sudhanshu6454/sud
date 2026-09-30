# Runbook: deploy & rollback

Dated 2026-09-23; revised 2026-09-29 for **afflino.com on the owner's
Linode**: one command, `deploy/linode/install.sh`, installs the whole single
host (`docker-compose.prod.yml` + `docker-compose.single-host.yml`, the edge
terminating TLS) and, run again, updates it. **Nothing has been deployed to
the Linode or to afflino.com from this repository yet**; the installer was
rehearsed in the sandbox (`deploy/linode/README.md` "What was checked"), §1R
is the stack rehearsal. §1A (added 2026-09-29) is the owner's Amazon.in
Associates steps, `deploy/linode/amazon.sh`, rehearsed the same way.

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
      vitest — 768 tests in 45 files on 2026-09-29 — both demos, the web
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

## 1A. Amazon.in Associates

What this sets up: tracked links `https://afflino.com/r/<token>` for the
owner's **own** Facebook pages, Instagram accounts and afflino.com that
send a shopper to `https://www.amazon.in/dp/<ASIN>?tag=<that page's
tracking ID>` with a plain 302 (no cookie, never a per-click id on Amazon's
URL), Amazon products in the shop with Amazon's wording, and the monthly
earnings download from Associates Central imported as conversions, each
attributed to its page by the tracking ID. Built and rehearsed with TEST
values only (store ID `demo-21`, tracking IDs `demo-*-21`, ASINs
`B0DEMO…`); the real values are the owner's and live only on the server, in
`/etc/afflino/afflino.env` and `/etc/afflino/amazon/`. **Nothing here says
the setup meets Amazon's terms.** It follows the Operating Agreement ("OA"),
the Participation ("PR") and Linking ("LR") Requirements as quoted in the
policy brief of 2026-09-29 (`packages/api/ASSUMPTIONS.md`, "Amazon.in
Associates"); the questions only Amazon or counsel can answer are rows of
`docs/action-tracker.md` ("Amazon.in Associates") and items of
`docs/counsel-briefing.md` §9.

### What you need first (on Amazon's side and counsel's; none of it is in this repository)

- An **amazon.in Associates account** (Associates Central) and its **Store
  ID**, which ends in `-21`. Amazon reviews the account after sign-up:
  "we require at least three [qualified sales] within the first 180 days",
  or the application is withdrawn.
- **Your website list** (Associates Central → Account Settings → Edit your
  website list) naming afflino.com and the exact URL of every Facebook page
  and Instagram account that will carry links. Amazon: "Your application
  must clearly list your social media page’s exact URL"; the pages must be
  "established, with a substantive number of organic followers/likes (in
  most cases, at least 500)", "publicly available" with "at least 10
  posts"; Facebook fan / open group pages, "excluding personal pages"; "You
  must own your website." Links carrying your tag may only appear on "your
  site" (PR 9), so **creators outside the in-house network never get Amazon
  links** (the API refuses them, `PROPERTY_NOT_OWNER_OPERATED`, and nothing
  can switch that off).
- **Only Facebook, Instagram and afflino.com.** Amazon: "We currently only
  accept the following social networks: Facebook (including open group
  pages and fan pages, but excluding personal pages), Instagram, Twitter,
  YouTube, Tik Tok, and Twitch.tv". The in-house network's Snapchat and
  Telegram accounts (and WhatsApp) are not on that list: `template` leaves
  them out, `setup` refuses them and the API refuses a link for them. The
  network has no YouTube channel today; one can be added to the build when
  you list it with Amazon.
- **Tracking IDs**, created in Associates Central: one per page
  that will carry links, and one for afflino.com. "There is a limit of 100
  Tracking IDs per associate account". None may contain an Amazon mark (PR
  12): the setup refuses "amazon", "kindle" and their misspellings, and
  alexa, echo, prime, prime video, audible, fire tv / firestick, imdb,
  zappos, whole foods — **Amazon's list of its marks is non-exhaustive**,
  so check each ID against Amazon's own list too.
- **The disclosure in every page's About / bio**: "As an Amazon Associate I
  earn from qualifying purchases." (OA §10; help: "For social media
  user-generated content, this statement must be associated with your
  account"). The site shows it by itself (step 4).
- **The privacy notice, from counsel, published on afflino.com/privacy.**
  OA §5: you must disclose "how you collect, use, store, and disclose data
  collected from visitors, including … that third parties (including us
  and other advertisers) may … place or recognize cookies on visitors’
  browsers". The redirect already stores a keyed hash of each clicker's
  address and the user agent. `/privacy` is a stub today, and **`links` and
  `shop` refuse to run while it is** (they read the page: the stub carries
  `data-document-status="stub"`). Counsel's text goes into the web app's
  privacy page and ships with the update line; then both steps run.
- Optional, later: **Creators API credentials** (a credential ID and a
  secret, version 3.2 for India; "Only the primary account owner … can sign
  up", and of the secret Amazon warns "It will only be displayed once during
  creation": enter it at `keys` right away). Amazon grants them only after
  final acceptance and "at least 10 qualifying sales within the past 30
  days". Without them nothing shows a price ("See price on Amazon.in");
  links and earnings work the same. **Expect prices to stop after the
  first 30 days**: Amazon grants "8640 TPD for the first 30-day period",
  after that "one TPD for every five cents … of shipped item revenue
  generated via the use of Creators API" — revenue through the API's own
  links, which this build does not use (it links `/dp/<ASIN>?tag=`, see
  `docs/capacity-plan.md`). The workers then back off (a 429 pauses the
  refresh until Amazon's `retryAfterSeconds` or the next day) and the shop
  shows "See price on Amazon.in"; nothing else depends on it.

### Which pages get links (the choice)

**One tracking ID per page, and links only for pages that have one.** With
Amazon's limit of 100 tracking IDs, that is afflino.com plus up to 99 pages:
pick the Facebook pages and Instagram accounts with the most followers that
meet Amazon's thresholds above and are on your website list. Why not share
one tracking ID among several pages, or post on every page under the Store
ID: Amazon's report names the tracking ID of each sale and nothing else about
where it came from (no click id: Amazon forbids a sub-tag tied to a specific
shopper "under no circumstances", LR), so a sale under a shared ID or the
Store ID cannot be tied to one page and would wait in the suspense queue for
a human (the system never guesses attribution). A page without its own
tracking ID therefore gets **no** links (`links` skips it and says so). For
more than 100 pages, ask Associates Customer Service for more tracking IDs
("If you have further requirements, please contact Associates Customer
Service") and add rows later: mappings are only ever added, never changed.

### The steps

As root on the Linode unless a step says "on your Mac". Each line is
complete; the values you type go into hidden prompts or into files, never
onto a command line. Every step can be re-run safely.

1. **Update** (the Amazon steps ship with the code):
   ```sh
   bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
   ```
2. **Settings**: the Store ID (hidden prompt), the in-house network's share
   of Amazon's fee in percent (it sets the first contract: the publisher
   "Afflino in-house network" is credited that share of every fee, the
   platform the rest — both are you; a change later needs a new contract
   version, `POST /v1/contracts`), and optionally the Creators API
   credential ID and secret (hidden). Nothing is printed but the names of
   the keys it set. Then the update line again, so the workers read the new
   settings:
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/amazon.sh keys
   bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
   ```
3. **The two files.**
   - `tracking-ids.csv` — one row per page on your website list:
     `platform,account,tracking_id`, where `platform` and `account` are the
     network's own (Facebook pages by page ID, Instagram by handle, `web`
     by host name). A starting file with every Facebook page, Instagram
     account and web property of the network and its URL (so you recognise
     each) is one line away; copy it to your Mac, keep only your pages,
     write one tracking ID per row, and save it as CSV under the same name
     (Numbers: File → Export To → CSV; Excel: CSV UTF-8):
     ```sh
     bash /opt/afflino/affiliate/deploy/linode/amazon.sh template
     ```
     on your Mac:
     ```sh
     scp root@afflino.com:/etc/afflino/amazon/tracking-ids.template.csv ~/Downloads/afflino-amazon-tracking-ids.csv
     ```
     **Or let the server build it** from the network's Meta exports
     (`/etc/afflino/meta`, "The in-house network" step 2): `plan <N>` keeps
     the N most-viewed Facebook / Instagram pages of the template (1–99;
     Amazon allows 100 tracking IDs and afflino.com takes one), numbers
     their tracking IDs under your Store ID after the pattern Amazon's help
     gives (`<store>-p01-21` … `<store>-pNN-21`, and `<store>-web-21` for
     afflino.com), writes `tracking-ids.csv` directly (or
     `tracking-ids.plan.csv` if one already exists, which is kept) and
     prints each tracking ID with its page, views and URL:
     ```sh
     bash /opt/afflino/affiliate/deploy/linode/amazon.sh template && bash /opt/afflino/affiliate/deploy/linode/amazon.sh plan 50
     ```
     Then, in Associates Central, create every printed tracking ID
     (Account settings → Manage tracking IDs → Add; type the part before
     `-21`) and list every printed URL on the account (Account settings →
     Edit your website and mobile app list). If Amazon refuses a name, edit
     that row of `/etc/afflino/amazon/tracking-ids.csv` to the one it gave
     you before `setup`. Measured on the owner's export of 2026-09-28: the
     top 50 pages had 97.8% of the network's 28-day views (top 25: 93%).
   - `asins.csv` — the products: `asin_or_url,brand,model,category,look`.
     `asin_or_url` is the ASIN or the amazon.in product URL (any
     `/dp/<ASIN>` form; short `amzn` links are refused, nothing here opens
     Amazon's pages). `brand`, `model` and `category` are **your own
     words** (Amazon's product text may be kept for 24 hours at most, OA
     §11). `look` (optional) groups products into a look of the shop under
     that title; rows without one get links for your pages only. For
     example (TEST values):
     ```
     asin_or_url,brand,model,category,look
     B0DEMO0001,Demo Brand,Demo Kettle,Home,Demo Kitchen picks
     https://www.amazon.in/Demo-Mug/dp/B0DEMO0002/,Demo Brand,Demo Mug,Home,Demo Kitchen picks
     ```
   Put both on the server, **from your Mac** (Spotlight finds the newest
   `afflino-amazon-tracking-ids.csv` and `afflino-amazon-asins.csv` wherever
   they are saved):
   ```sh
   ssh root@afflino.com 'mkdir -p /etc/afflino/amazon' && for n in tracking-ids asins; do f=$(mdfind -name "afflino-amazon-$n" 2>/dev/null | grep -E '\.csv$' | while IFS= read -r p; do printf '%s\t%s\n' "$(stat -f %m "$p")" "$p"; done | sort -n | tail -1 | cut -f2-); if [ -n "$f" ]; then echo "copying $f"; scp "$f" "root@afflino.com:/etc/afflino/amazon/$n.csv"; else echo "no afflino-amazon-$n.csv found on this Mac"; fi; done
   ```
   or type (paste) each on the Linode, ending with Enter and then Ctrl-D:
   ```sh
   mkdir -p /etc/afflino/amazon && cat > /etc/afflino/amazon/tracking-ids.csv
   mkdir -p /etc/afflino/amazon && cat > /etc/afflino/amazon/asins.csv
   ```
4. **The programme and the account** (merchant "Amazon.in", programme
   "Amazon.in Associates", the account with your Store ID, one campaign, one
   placement per row of `tracking-ids.csv`, the first contract, the
   tracking-ID mappings; all in one transaction), and **the Associate
   statement in every page's footer** from then on ("As an Amazon Associate
   I earn from qualifying purchases.", `AMAZON_ASSOCIATE=on`; the web
   restarts once):
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/amazon.sh setup
   ```
   It refuses, writing nothing, a changed Store ID, a tracking ID mapped to
   another page before, a second tracking ID for a page, the Store ID as a
   page's tracking ID, a page that is not yours (no `owner_operated`
   verification), a Snapchat / Telegram / other page Amazon does not
   accept, a malformed or trademark-bearing ID, and TEST values. **Run it
   before you post**: a mapping counts from the moment it is made, so a
   sale dated earlier waits in suspense (`TRACKING_ID_MAPPED_AFTER_SALE`).
5. **The products**:
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/amazon.sh offers
   ```
   Offers are created without a price, linkable for 30 days (re-running
   extends it; the price refresh extends it for every product Amazon still
   lists). A product Amazon's product API reported not accessible stays
   paused when you list it again (the step says which); the price refresh
   brings it back when Amazon lists it again. Brand, model, category and
   the optional `look` column are your own plain words: a row that names a
   celebrity or uses endorsement wording ("worn by", "dupe", "for less",
   "<Brand> style", "inspired", "first copy" …) refuses the whole file,
   nothing written (a product can stand in a celebrity's outfit, and its
   text is what every look shows). The `look` column makes a **product
   shelf** in the shop (items without a match verdict: "Unverified
   match"); it never names or joins a celebrity look — those come only
   from the library (§1C), with EXACT only by evidence and a second
   person.
6. **The links**, one per (page with its own tracking ID) × product, minted
   through the API with every guard; the sheet goes to
   `/etc/afflino/amazon/links.csv` (`platform,account,tracking_id,asin,
   brand,model,look,post_label,link_url`). It refuses to run until the
   privacy notice is published (above) and the footer statement is on
   (step 4). Then copy the sheet to your Mac:
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/amazon.sh links
   ```
   on your Mac:
   ```sh
   scp root@afflino.com:/etc/afflino/amazon/links.csv ~/Downloads/afflino-amazon-links.csv
   ```
   Post each page's own `link_url` on that page only (a link carries its
   page's tracking ID), and start every post with its `post_label`
   (`#ad · Buy on Amazon.in`: the link-level disclosure and the fact that
   the link goes to Amazon.in; the exact wording and placement under the
   ASCI guidelines is counsel's, pending). What every post needs, as Amazon
   words it:
   - a disclosure near the link ("as simple as "(paid link)", "#ad", or
     "#CommissionsEarned"", placed "near any affiliate link") — the
     `post_label`;
   - a clear statement that the link goes to Amazon.in (PR 20; LR: no link
     that makes it "unclear that you are linking to an Amazon Site");
   - **no prices** (a post cannot be refreshed; a product-API price may be
     shown for an hour, OA §11 caps any at 24 hours) and **no Amazon
     product images** (OA §11: images may not be stored or altered);
   - **no Amazon customer reviews or star ratings** (PR 28);
   - no inaccurate or misleading claim about a product, Amazon.in or its
     policies (LR: "You must not make inaccurate, overbroad, deceptive or
     otherwise misleading claims"); never "dupe", "fake" or "faux" next to
     a brand (help GER4LUCFFTZJ2FDC);
   - a limited-time promotion mentioned only until it ends: **delete or
     edit the post on or before its end date** (LR: "You must remove from
     your site any links and related references to limited time promotions
     on or before the expiration date");
   - no coupon codes (help GUPDNS3EVD952D97), cashback or other incentive
     for using the link (PR 14), and never a note that proceeds go to a
     charity (help G4J8JEGHNV5ERKLT);
   - never in emails, PDFs, print or QR codes (help: "not permitted to be
     used in emails, offline promotions or in any offline manner"), never
     on Snapchat, Telegram or WhatsApp, never as a paid-ad landing page (PR
     13); no buying through your own links (OA §7);
   - no press release or public announcement about joining the programme
     (OA §10: "You will not issue any press release or make any other
     public communication with respect to … your participation in the
     Program").
7. **The shop**: points the shop at its Amazon placement
   (`WEB_PLACEMENT_ID`) and gives it its read-only token (`WEB_API_TOKEN`,
   minted in the api container, never printed), then restarts the web. The
   same privacy-notice condition as step 6:
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/amazon.sh shop
   ```
   From then on `/shop` shows the live looks (the Amazon looks from
   `asins.csv`) instead of the TEST demo looks. Each Amazon product shows
   "See price on Amazon.in" — or, once the Creators API supplies a price,
   "Amazon.in Price", the amount, "(as of DD/MM/YYYY HH:MM IST)" and
   Amazon's price disclaimer, for one hour at most (the Creators API's
   "Offers | 1 hour"; OA §11's 24 hours is the outer limit, the conflict is
   counsel's, §9) — the "Buy on Amazon.in" button (the tracked link only),
   the Associate statement (always, first), "You complete the purchase on
   Amazon.in; Amazon.in's terms apply." (draft pending counsel), and on the
   look "Affiliate links: Yes (we earn from qualifying purchases)" where
   other looks say "Sponsored".
8. **Earnings**: once a month, after the month has ended, download the
   **Earnings** report for that month from Associates Central's reports
   (Amazon: "the various values are separated by tabs") and copy it to the
   server **from your Mac**
   (the newest file whose name contains "Earnings"; rename it
   `afflino-amazon-earnings.tsv` if Spotlight finds none):
   ```sh
   f=$(mdfind -name Earnings 2>/dev/null | grep -Ei '\.(tsv|csv|txt)$' | while IFS= read -r p; do printf '%s\t%s\n' "$(stat -f %m "$p")" "$p"; done | sort -n | tail -1 | cut -f2-); if [ -n "$f" ]; then echo "copying $f"; ssh root@afflino.com 'mkdir -p /etc/afflino/amazon/reports' && scp "$f" root@afflino.com:/etc/afflino/amazon/reports/; else echo "no earnings report found on this Mac"; fi
   ```
   then on the Linode:
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/amazon.sh import
   ```
   Every file in `/etc/afflino/amazon/reports/` is imported once (oldest
   first) and moves to `reports/imported/`; a refused file stays, with the
   reason. **The download's layout is not documented by Amazon**: until a
   real download has been checked (send one, with a returned item in it),
   the first import may be refused with "unknown layout" — nothing is
   written then. A row imported before with other amounts refuses the whole
   file (409, nothing written: the system never rewrites an amount), which
   is why each month is downloaded once, after it is over ("Your Earnings
   Report is current as of the previous day"). Imports of one account run
   one at a time (a second one waits, then is refused with nothing
   written). Returns reverse their one matching sale; a return that
   matches none or several is listed and not applied — the next step.
9. **Returns the import could not match** (only when `import` said some
   "matched no single sale"): each is listed with the sales it could belong
   to (date, what is left to reverse, how it was attributed); type the
   number of the right one (look it up in Associates Central's order
   reports), or press Enter to leave it. The choice is applied once under
   the import's own id: running this again, or importing the same report
   again, changes nothing.
   ```sh
   bash /opt/afflino/affiliate/deploy/linode/amazon.sh returns
   ```
10. **Check**:
    ```sh
    bash /opt/afflino/affiliate/deploy/linode/amazon.sh check
    ```
    It prints the counts (pages and tracking IDs, offers, looks, links,
    clicks, conversions by tracking ID / in suspense by reason) and asks the
    redirect for one link once without following it (one click row, user
    agent `afflino-check`; nothing reaches Amazon). Expect `HTTP/1.1 302
    Found`, `location: https://www.amazon.in/dp/<ASIN>?tag=<that page's
    tracking ID>`, `x-robots-tag: noindex, nofollow` and no `set-cookie`.
    Software (link previews, crawlers, `curl`, headless browsers, a missing
    user agent), prefetches and `HEAD` get a preview page instead: no click
    row and no tagged URL (PR 27, a heuristic counsel is to confirm).

**Stopping it** (Amazon asks, or anything looks wrong): the kill switch,
the same as §4's, for the Amazon programme. Every Amazon link serves the
paused page at once (no redirect, no click) and no link can be minted until
it is resumed:
```sh
bash /opt/afflino/affiliate/deploy/linode/amazon.sh pause
bash /opt/afflino/affiliate/deploy/linode/amazon.sh resume
```

**Changing things later**: a new page → a new row (with its new tracking
ID) in `tracking-ids.csv`, then `setup` and `links` again (new links for
the new page only). New products → new rows in `asins.csv`, then `offers`
and `links`. A product Amazon no longer lists is marked stale by the price
refresh (its links serve the paused page); it stays paused when listed
again and comes back when Amazon's product API lists it again. The Creators
API credentials → `keys` again and the update line.

**Rehearsed 2026-09-29** (again after the review fixes) on the installer's
stack in test mode (`deploy/linode/README.md` "What was checked": a
throwaway project, the TEST example network seeded, TEST values fed to the
prompts from standard input, then `down -v`). What each step printed, with
the TEST values (yours will show your own IDs and counts):
- `keys`: `set in /etc/afflino/afflino.env (root:root 0600): AMAZON_STORE_ID
  AMAZON_PUBLISHER_SHARE_BPS` — no value in the output; the update line after
  it changed no container. A Store ID with "alexa" in it: `STOPPED: that
  Store ID contains an Amazon trademark (amazon, kindle, alexa, echo, prime,
  audible, fire tv, imdb, …) … nothing changed`.
- `template`: `amazon: template of 4 owner-operated Facebook / Instagram /
  web properties (0 with a tracking ID already) … left out (Amazon links
  never go there): 1 youtube, 1 snapchat, 1 telegram`, one row per page with
  its URL.
- `setup`: under the image's `NODE_ENV=production` the TEST values are refused
  (`REFUSING under NODE_ENV=production: TEST values (demo-21, demo-shop-21,
  demo-ig-21) are fixtures, not a real account`, nothing written); a
  Snapchat row: `platform 'snapchat' cannot carry Amazon links …`, nothing
  written; with the test-only override: `3 declared page(s): 3 with their
  own tracking ID, 0 on the store ID; 3 tracking ID(s) added now`, the shop's
  placement, and `set in /etc/afflino/afflino.env: AMAZON_ASSOCIATE; the web
  runs with it (healthy): every page's footer shows the Associate
  statement` (the home page: 0 statements before, the statement after); a
  second run `0 tracking ID(s) added now` and `every page's footer already
  shows the Associate statement`.
- `offers`: `2 offer(s): 2 new, 2 active; no prices until the product API
  supplies them` and `shelf 'Demo Kitchen picks': published, 2 product(s)
  added (no match verdict: celebrity looks come from the library)` (the
  wording from 2026-09-30; a shelf's items carry no EXACT claim since then).
- `links` and `shop` while `/privacy` was the stub: `STOPPED: afflino.com/privacy
  is still the stub page. Amazon requires a privacy notice … nothing was
  changed` (no link minted, no sheet written). With the test-only
  `AFFLINO_AMAZON_SKIP_PRIVACY_CHECK=1`: `links for 3 placement(s) with their
  own tracking ID × 2 live offer(s): minted 6, existing 0, failed 0`, every
  row `…,#ad · Buy on Amazon.in,https://afflino.com/r/<token>`; again:
  `minted 0, existing 6`, a byte-identical sheet; `shop`: `set in
  /etc/afflino/afflino.env: WEB_PLACEMENT_ID WEB_API_TOKEN`, the web healthy
  again, `/shop` switched from the "Demo data" looks to `Demo Kitchen
  picks`; the look page showed "See price on Amazon.in", "Buy on Amazon.in"
  on `<a href="https://afflino.com/r/<token>" rel="sponsored nofollow
  noopener"`, the Associate statement, "Affiliate links: Yes (we earn from
  qualifying purchases)" and no "Sponsored" fact, no amazon.in URL,
  `noindex, nofollow` (TEST look); the item page "You complete the purchase
  on Amazon.in; Amazon.in's terms apply." and no "Payment, delivery and
  returns are handled by".
- `GET /r/<token>` through the edge: `HTTP/1.1 302 Found`, `Location:
  https://www.amazon.in/dp/B0DEMO0002?tag=demo-shop-21` (the Instagram page's
  link: `tag=demo-ig-21`), `X-Robots-Tag: noindex, nofollow`,
  `strict-origin-when-cross-origin`, no `set-cookie`, one click row;
  `facebookexternalhit`, `curl/8.5.0`, `HeadlessChrome`, no user agent,
  `Sec-Purpose: prefetch;prerender` and `HEAD` → `200`, the preview page
  ("A link to a product on Amazon.in"), no click, no tagged URL.
- `import`: the TEST earnings report → `4 row(s): shipped 4 new (2 by
  tracking ID, 0 by click, 2 to suspense)` (an unknown tracking ID, and a sale
  dated before its mapping), moved to `reports/imported/`; the same file again
  → `0 new … 4 already imported`; a file with a changed fee → `CONFLICT: 2
  row(s) were imported before with different amounts; amounts are never
  rewritten, nothing was imported`, the conversion and ledger counts
  unchanged, the file left in place; the TEST return → `returns 1 applied`;
  a second sale of the same product and page and then a return that could
  be either → `returns 0 applied, 0 already applied, 1 matched no single
  sale … the returns step lists each with its possible sales`.
- `returns`: `return 1: 2026-10-05, tracking ID demo-ig-21, ASIN B0DEMO0001,
  fee to reverse INR 40.00 (AMBIGUOUS)` with `1) the sale of 2026-10-01 …
  INR 80.00 left to reverse` and `2) the sale of 2026-10-03 … INR 160.00
  left to reverse`; `2` typed → `applied: that sale is reversed by the fee,
  the ledger mirrored`; run again → `no unmatched return`. Ledger balanced
  (`INR 51984 / 51984`); the in-house publisher credited `19588` paise.
- `check`: `conversions 5 {"approved": 5}: by tracking ID 3, by click 0, in
  suspense 2 {"TRACKING_ID_MAPPED_AFTER_SALE": 1, "TRACKING_ID_UNMAPPED": 1}`
  and the `302` / `location … tag=demo-shop-21` / `x-robots-tag` lines.
- `pause`: `paused; cached routes cleared: 6`, the link → `200` (paused page),
  `links` refused; `resume` → `302` again; `audit_log`:
  `amazon.return_applied, programme.pause, programme.resume`. The update
  line afterwards changed nothing (same containers, same environment-file
  hash).

Not checked (needs the real account): Amazon accepting the links and the
redirect, a real earnings download, the Creators API (the workers were never
given credentials in the rehearsal), a published privacy notice (the
rehearsal skipped that check with its test-only setting after showing both
refusals).

## 1C. Celebrity looks, storefronts and Engage (comment replies)

What this sets up: the owner's paparazzi library as **draft** looks (each a
moment: a celebrity, an event or place, a date, the source video, a still,
the in-house page and post that published it) with the outfit piece by
piece; counsel's decision per celebrity; products tagged into each piece as
EXACT (the same item: evidence and a second person's approval) or SIMILAR
(a similar style; the default); publishing; the public pages (the Spotted
feed on `/shop`, a celebrity's hub `/c/<slug>`, the look piece by piece
`/looks/<id>`, a storefront per in-house page `/s/<slug>` for its bio);
takedowns; comment replies (the product's name for what you asked for as
"Engage": a keyword in a comment → one private message with the look's
afflino.com page). Nothing about a celebrity appears on afflino.com before
counsel's review allows it (the default is `unreviewed`: nothing is shown),
and celebrity pages stay out of search engines until `CELEBRITY_INDEXING=on`
(off by default; counsel's call). **Nothing here says it is lawful**: the
open questions are `docs/counsel-briefing.md` §10 and `docs/action-tracker.md`
"Celebrity looks".

### What you need first
- The library file, never in the repository: a CSV named
  `afflino-library….csv` on your Mac (Spotlight finds the newest), one row
  per outfit piece of a moment (a row without piece columns is a moment with
  no piece yet). The columns:

  | Column | Required | What goes in it |
  |---|---|---|
  | `video_ref` | yes | the source video in the library (one look per video; `moment_ref` for several moments in one video) |
  | `celebrity` | yes | the full name; a new name is created **unreviewed** |
  | `moment_date` | yes | `YYYY-MM-DD`, in the past (never live whereabouts) |
  | `still_ref` | yes | the still in the library |
  | `licence` | no: blank = **owned** | leave every licence column blank (or leave the columns out) and the row takes your **ownership statement** (step 2: commercial use, worldwide, no end, your company as the copyright owner, the statement as the chain of title); fill it only for a clip that is *not* yours outright (an agency's licence reference), with the next three |
  | `commercial_reuse` | with a licence of its own | `yes`, `no` or `unknown` (only `yes` lets the still be shown) |
  | `territory` | with a licence of its own | `IN`, `WW` or a list such as `IN,AE` |
  | `licence_expires` | with a licence of its own | `YYYY-MM-DD` or `none` (the still disappears when it expires) |
  | `moment_ref`, `aliases` (`;`-separated), `celebrity_minor` (`yes`/`no`: a minor is never published) | no | |
  | `event`, `place`, `place_kind` | no | a public event or venue, coarse — never a home, a building or society, a hospital or clinic, a school or class, a place of worship; `place_kind` `event`, `venue`, `airport`, `street`, `studio` or `other` (a `street` or `other` look is published only after the rights reviewer confirms its place in the admin); in your own words, never a celebrity's name |
  | `platform`, `account` | no | the in-house page that posted it (`facebook` + the page ID, or `instagram` + the handle) |
  | `post_permalink`, `platform_post_id` | no | the post (https) and its id (comment replies need the id) |
  | `still_url` | no | the still's public copy (https) |
  | `copyright_owner`, `acquisition`, `assignment_ref` | with a licence of its own and `commercial_reuse` `yes` | the chain of title: who owns the footage, how it was acquired (`staff`, `freelance`, `agency`, `licensed` or `other`) and, for anything but `staff`, the written assignment or licence's reference; a row claiming commercial reuse without them refuses the file, and a still without them is never shown (blank with the other licence columns: your ownership statement) |
  | `source_ref`, `author` | no | the library's own reference and who filmed it |
  | `live_performance`, `minor_in_frame`, `bystanders`, `sensitive_location` | no | `yes`/`no`: any `yes` keeps the still off every page |
  | `celebrity_display` | no | `name_only` or `name_and_image` (never more than the review allows) |
  | `piece_label`, `piece_category`, `piece_order`, `piece_x`, `piece_y` | no | one row per piece: the label in your words ("The shirt"; never a name), the garment category (`top`, `shirt`, `t_shirt`, `kurta`, `dress`, `saree`, `lehenga`, `outerwear`, `suit`, `trousers`, `jeans`, `skirt`, `shorts`, `co_ord_set`, `ethnic_set`, `footwear`, `bag`, `eyewear`, `watch`, `jewellery`, `belt`, `headwear`, `scarf`, `other`), the order, the marker's position on the still (0 to 1 across and down, both or neither; eyewear, headwear and jewellery get no marker on the page) |

  A TEST example (fictional people, example.com; every column:
  `db/fixtures/library.example.csv`), two pieces of one moment:

  ```
  video_ref,celebrity,moment_date,event,place,place_kind,platform,account,post_permalink,platform_post_id,still_ref,still_url,licence,commercial_reuse,territory,licence_expires,copyright_owner,author,acquisition,assignment_ref,live_performance,minor_in_frame,bystanders,sensitive_location,celebrity_display,piece_label,piece_category,piece_order,piece_x,piece_y
  demo-vid-0101,Demo Star One,2026-09-12,Demo Film Premiere,Demo City,event,instagram,demo.afflino,https://instagram.example.com/p/demo-0101,17900000000000101,demo-stills/0101.jpg,https://cdn.example.com/demo-stills/0101.jpg,TEST staff footage,yes,IN,2027-12-31,Demo Media (TEST),Demo Shooter,staff,TEST-ASSIGN-001,no,no,no,no,name_and_image,The shirt,shirt,0,0.42,0.35
  demo-vid-0101,Demo Star One,2026-09-12,Demo Film Premiere,Demo City,event,instagram,demo.afflino,https://instagram.example.com/p/demo-0101,17900000000000101,demo-stills/0101.jpg,https://cdn.example.com/demo-stills/0101.jpg,TEST staff footage,yes,IN,2027-12-31,Demo Media (TEST),Demo Shooter,staff,TEST-ASSIGN-001,no,no,no,no,name_and_image,The shoes,footwear,1,0.47,0.9
  ```
  Your own clips need no licence columns at all. The same moment, owned
  (the licence from your ownership statement):

  ```
  video_ref,celebrity,moment_date,event,place,place_kind,platform,account,post_permalink,platform_post_id,still_ref,still_url,celebrity_display,piece_label,piece_category,piece_order,piece_x,piece_y
  demo-vid-0101,Demo Star One,2026-09-12,Demo Film Premiere,Demo City,event,instagram,demo.afflino,https://instagram.example.com/p/demo-0101,17900000000000101,demo-stills/0101.jpg,https://cdn.example.com/demo-stills/0101.jpg,name_and_image,The shirt,shirt,0,0.42,0.35
  ```
  The whole file is refused (nothing written) when a row without licence
  columns comes before any ownership statement is recorded, a row fills
  some licence columns but not `licence`, `commercial_reuse`, `territory`
  and `licence_expires`, or lacks its chain of title, has a bad value, names a page that is not
  yours, a sensitive place, endorsement wording ("worn by", "dupe", "for
  less", "inspired", "replica", "7A", "lookalike", "as seen", …) or a
  celebrity's name in its event, place or piece label (a name appears on a
  page only in the credit line of that person's own look); a second run
  changes nothing. A frame flag (`minor_in_frame`, `bystanders`,
  `sensitive_location`) once `yes` stays `yes` (a later file cannot clear
  it), and `celebrity_minor` `yes` pauses that person's links at once.
- Counsel's decision for each celebrity you want to publish (the evidence
  reference: counsel's written advice or the licence).

### The steps (each is one line; values are asked at prompts)

1. **On your Mac**, copy the newest library file to the server:

   ```bash
   ssh root@afflino.com 'install -d -m 0755 /etc/afflino/library' && f=$(mdfind -name "afflino-library" 2>/dev/null | grep -E '\.csv$' | while IFS= read -r p; do printf '%s\t%s\n' "$(stat -f %m "$p")" "$p"; done | sort -n | tail -1 | cut -f2-); if [ -n "$f" ]; then echo "copying $f"; scp "$f" root@afflino.com:/etc/afflino/library/library.csv; else echo "no afflino-library….csv found on this Mac"; fi
   ```
2. As root on the Linode, **the first time only**, record your statement
   that you own the library's footage (asks the legal name of the company
   or person that owns it, who shot the clips — `1` your own employees
   only, `2` employees and freelancers or agencies working for you — shows
   the statement's words and records it, dated, when you type `yes`):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh owned
   ```
   Every row without licence columns then takes it; a row with its own
   licence keeps that. It covers the footage only: each celebrity's own
   rights still go through step 4, and nothing about a celebrity is shown
   without it. Run it again to correct the name (the new statement replaces
   the old one at the next import); `looks.sh owned withdraw` ends it, and
   every clip licensed by it stops showing its image at once.

   Then import the file (drafts; new celebrities unreviewed):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh import
   ```
   It prints the looks created (drafts), updated and unchanged, the
   celebrities created (unreviewed) or matched, the assets and the pieces,
   and how many looks took their licence from your statement. A clip whose
   licence a person changed in the admin is never widened by a file (the
   line "kept as a person set it" names it; the rights reviewer changes it
   in the admin). (Small files can also be checked and imported in the
   admin: Library.)
3. Each celebrity's page name (slug), status and what it may show:

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh celebrities
   ```
4. **Only after counsel's decision**, record it, one celebrity at a time
   (asks the slug, the status — `unreviewed`, `editorial` (name only, no
   products), `cleared` (counsel cleared a page with products) or `blocked`
   — whether the photo may be shown, whether products may be shown, the
   evidence reference and a note; `editorial` and `cleared` need the
   reference):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh review
   ```
5. Storefronts: a draft for every in-house Facebook / Instagram page and
   each page's bio link (`https://afflino.com/s/<slug>`; optional
   `/etc/afflino/library/storefronts.csv` with
   `platform,account,slug,display_name[,bio][,status]` for your own slugs and
   bios):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh storefronts
   ```
   then make them public (a live storefront shows only public looks; the
   bio link of a draft is a 404):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh storefronts live
   ```
   Put each page's printed bio link in that page's bio.
6. A sign-in for the admin (8 hours; written to a root-only file, never
   shown), then **on your Mac** copy it to the clipboard and paste it at
   `https://afflino.com/login`:

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh signin
   ```
   ```bash
   ssh root@afflino.com 'cat /etc/afflino/admin-sign-in.token' | pbcopy && echo "copied: paste it at https://afflino.com/login"
   ```
   (Choose 1, the network admin, for tagging and publishing; 2, the rights
   reviewer, only for counsel's decisions in the admin's Celebrities screen;
   3, the second editor, for the person who approves EXACT tags — never the
   one who tagged them. The sign-in cannot tell people apart, so give each
   one only to its person. A new sign-in replaces the file.)
7. In the admin (`https://afflino.com/admin/looks`): open a look, check the
   moment and the still's licence panel (pass the frame screen), then the
   outfit piece by piece — add / rename / reorder pieces, place each marker
   on the garment, and tag products per piece: paste the amazon.in link or
   ASIN, name it in your own words (the brand, model and category too:
   never a celebrity's name or an endorsement word — "inspired", "replica",
   "<name> style", "as seen" are refused), choose SIMILAR (the default) or
   EXACT (the evidence and its source are required; a **second** editor,
   signed in with choice 3, approves it — the tagger cannot; "Needs a second
   person" in the looks list shows what waits). A look whose place is a
   `street` or `other` needs the rights reviewer (choice 2) to confirm the
   place (the look's Moment panel: "Confirm the place") before it can be
   published. The publish gate lists, in plain words, what is still
   missing; Publish when every check passes. Instant links (the admin's
   Instant links) always tag the product into a piece you choose, as
   SIMILAR unless you tag it EXACT (then its links wait for the second
   person's approval: run it again after the approval), and give the
   tracked link for each chosen page (a post on that page carries it with
   its label; the look's own page shows its web link, never a post's) and
   the look's afflino.com URL — the only URL a message may carry. A
   storefront's name, slug and bio name nobody (a storefront that names a
   celebrity cannot go live).
8. Counts at any time:

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh status
   ```

### Takedown (a rights holder's request, a legal notice, a court order)

Act at once; the benchmark is **3 hours** for an order and 36 hours for a
privacy request (IT Rules; counsel confirms Afflino's own timelines). In the
admin (Takedowns) or here:

```bash
bash /opt/afflino/affiliate/deploy/linode/looks.sh takedown
```
It asks: a whole celebrity or one look, which one, the reason, the notice's
reference (no names) and when it arrived. From that moment every public page
of it answers **410** (the look, its item pages, the hub; the feed, the
storefronts and the sitemap drop it), its links serve the paused page, its
comment replies stop (queued ones are cancelled) and the caches are cleared
(the redirect's routes; the web's pages through `/internal/revalidate`; the
public API's own answers at once). A whole celebrity also withdraws the
other looks whose text names that person, and pauses the plain links of
those looks' products on their pages. The still's afflino.com address
(`/img/looks/<id>`) answers 410 too. It prints, in order: 1. the in-house
posts **you delete on Facebook / Instagram yourself** (Afflino cannot);
2. the addresses to paste into Meta's Sharing Debugger
(developers.facebook.com/tools/debug, "Scrape Again") so the link previews
already shared refresh; 3. the stills, by their library reference (remove
the origin files too if counsel asks). The list, with the time each took to
act (the 1 h and 3 h marks):

```bash
bash /opt/afflino/affiliate/deploy/linode/looks.sh takedowns
```
Lifting one needs a new review recorded after the takedown (`review`, then;
only a look that is public and allowed products gets its links back, the
rest stay paused for a rights review):

```bash
bash /opt/afflino/affiliate/deploy/linode/looks.sh restore
```

### Engage: comment replies (off until you turn them on)

A comment with a rule's keyword on a rule's post gets one private reply with
the look's afflino.com URL (never a tracked link or an Amazon URL), an "Ad"
label, an automated-message line and "Reply STOP" (the text, exactly: the
admin's Comment replies screen, or `reply-test` below). Meta's side first
(`docs/action-tracker.md` "Meta app for comment replies": Business
Verification, App Review with Advanced Access, Live mode; counsel's privacy
notice on `/privacy`). Then, as root on the Linode:

1. The app secret, a verify token **you make up** (16 or more letters or
   digits; you type the same string into Meta's dashboard in the next step;
   it is never shown) and the system user's token, each at a hidden prompt:

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh keys
   ```
2. The webhook: it prints what to set in Meta's App Dashboard and shows no
   secret — Webhooks: the Page object with the fields `feed`, `messages` and
   `messaging_policy_enforcement`, the Instagram object with `comments` and
   `messages` (`messages` carries a STOP sent in reply;
   `messaging_policy_enforcement` Meta's warnings and blocks), the callback
   address, and the verify token you made up in step 1 (type it again
   there); App settings > Basic > Data deletion: the callback address
   `https://afflino.com/api/v1/integrations/meta/data-deletion` (a signed
   request from Meta deletes that person's reply events and answers a
   confirmation code; the opt-out list keeps their hash, so no message ever
   goes to them again — counsel's question Q14); each Page's messaging response mode:
   hybrid, so a person answers what the automation does not. Every delivery
   is checked against the app secret:

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh webhook
   ```
3. The update line, so the api and the workers read them:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
   ```
4. Map the pages to their Meta ids and subscribe their webhooks:

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh accounts
   ```
5. A test against the stub (asks for a look's id): whether replies may go
   out for it (only while the look is public and carries products on a live
   offer), the exact message for that look, handed to a stub sender (nothing
   is sent to Meta), and the webhook's own checks — the verify handshake, a
   correctly signed TEST delivery for an account no page is mapped to (200,
   nothing stored), a wrongly signed one (401) and a signed STOP message
   (`messaging stop: ok`: the TEST suppression written and removed):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh reply-test
   ```
6. Turn replies on per post in the admin (Comment replies: keywords, the
   optional public answer — one of three fixed texts, "We sent you a
   message with the link." and two like it, never a link, a name or a
   product — on/off; a rule can be turned on only for a look that may send),
   run in shadow first (every check, nothing sent), then on (refused while
   `/privacy` is the stub page):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh replies shadow
   ```
   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh replies on
   ```
   and back off at any time:

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh replies off
   ```
7. The latest events (when, which page, which keyword, what happened — no
   comment text, username or commenter id):

   ```bash
   bash /opt/afflino/affiliate/deploy/linode/looks.sh events
   ```

### Search engines
Celebrity pages (looks, hubs, storefronts, and `/shop` while its feed shows
a look) carry `noindex` and stay out of the sitemap until both
`SITE_INDEXING=on` and `CELEBRITY_INDEXING=on` are set in
`/etc/afflino/afflino.env`. Turning `CELEBRITY_INDEXING` on is counsel's
call (`docs/counsel-briefing.md` §10).

### What was checked (sandbox, TEST data)
Stage 1: the CLI in the built api image, the workers' queues, the public API
and the webhook's verification, the edge's 404 for `/internal/*`, the story
and its races on a real Postgres 16 (`pnpm looks:pg`). Stage 2 (2026-09-30):
the web pages and admin screens on a local stack (a scratch Postgres 16 with
the TEST library, the tsx api and redirect, `next start` on the build):
the feed, a hub, a look piece by piece, a storefront, a withdrawn look 410
from the middleware and its item pages, a hub 404 for a celebrity with no
public look, the revalidation call after a takedown and after its restore
(`web: attempted, ok, 200`), a wrong revalidation secret 401, the 410 from
a look's page 5.0 s after its takedown; the looks CLI's `storefronts` (bio
links), `events`, `reply-test` (verify ok, wrong token 403, signed delivery
200 with nothing stored, wrong signature 401), `sign-in --role editor` (an
EXACT tag: its tagger's approval 403, the second editor's 200); the new
steps of `looks.sh` in the installer's rehearsal (`deploy/linode/README.md`
"What was checked"); ShellCheck 0.11.0 and 0.9.0. After three independent
reviews (2026-09-30): the fixes above (names only in a look's own credit
line, name-free headlines, the product-text rule, chain of title, place
confirmation, the still at its own address, the public API's rate limit and
epoch cache, EXACT links after approval, look links on the web page only,
the data-deletion callback, fixed public answers) re-checked by `pnpm
looks:pg` and the local stack: a withdrawn look answered 410 on `next
start` and on the standalone server (the page in the shop's layout, no
script), 5.5 s after a takedown on a page probed just before; its still
410; `/r/` the paused page; the restore 409 without a new review, then 200
and `/r/` 302 with afflino.com's tag; a visitor over the public API's limit
429 while another visitor and the pages stayed 200. Not run on the Linode,
and no Meta call was made.

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
- **No merchant programme exists** until the owner runs §1A (Amazon.in
  Associates) with the real account. The shop shows labelled TEST demo looks
  ("Demo data" badge) from the web's own demo data until then; with §1 step 6
  it shows the network seed's TEST looks, whose links go to
  `shop.example.com`; after §1A's `shop` step it shows the Amazon looks.
  Amazon prices appear only once Amazon grants the Creators API (10
  qualifying sales in 30 days) and its keys are set; Amazon's payments are
  not recorded as merchant settlements by anything yet, so no Amazon
  earning becomes payable in the system (the payout rail is the stub
  anyway).
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
contracted merchant programmes and a real payout rail; for Amazon.in, the
owner's and counsel's rows in `docs/action-tracker.md` ("Amazon.in
Associates": the account's approval and website list, Amazon's word on the
`/r/` redirect, the disclosure wording, a real earnings download).

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
