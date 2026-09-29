# deploy/linode — afflino.com on the owner's Linode

Five bash scripts, run as root on the Linode (Ubuntu 24.04 recommended;
Ubuntu 22.04 and Debian 12 accepted). The server needs nothing installed
first: no make, no node, no dig; bash, curl and python3 come with the image.
The procedure around them (DNS, checks, rollback, the kill-switch drill) is
[`docs/runbooks/deploy.md`](../../docs/runbooks/deploy.md); the overview is
README.md "Deploying afflino.com on Linode".

| Script | What it does |
|---|---|
| `install.sh` | Install, and every later run update: preflight (root, the OS, a server of its own), system (packages, Docker, ufw, fail2ban, unattended upgrades, swap on small plans), the code in `/opt/afflino` (the release before kept as the git tag `afflino-previous`; the rest of the run is the checkout's own copy of the script), the secrets in `/etc/afflino/afflino.env` (generated, never printed), `docker compose build`, the migrations on their own, `up -d`, health, the DNS status, the daily backup timer |
| `backup.sh` | `pg_dump` inside the postgres container → `/var/backups/afflino/afflino-<UTC time>-<kind>.sql.gz` (0600, checked, the 14 newest of each kind kept); run daily at 02:30 UTC by `afflino-backup.timer` |
| `restore.sh` | Default: restores the newest dump into a scratch database and checks it (migrations, tables, row counts, the ledger balanced per currency), the live database untouched. `--replace-live`: after you type `REPLACE`, takes a pre-restore backup, loads the dump into a staging database (a failed load changes nothing), then swaps it in while web, api, redirect and workers are stopped for a few seconds, and clears the redirect's route cache in Redis (`route:*`) before starting them again |
| `godaddy-dns.sh` | Optional, needs GoDaddy API access: sets `A @` and `AAAA @` for afflino.com to this server, keeps the `www` CNAME, prints before / after. Two hidden prompts — a personal access token (Enter at the secret prompt: `Bearer`) or an API key and its secret (`sso-key`); never stored |
| `amazon.sh` | The owner's Amazon.in Associates steps (`docs/runbooks/deploy.md` §1A), one argument each: `keys` (hidden prompts: the Store ID, optionally the Creators API id and secret; the in-house share in percent; written to `/etc/afflino/afflino.env`, never printed), `template` (Facebook / Instagram / web pages only), `setup` (and `AMAZON_ASSOCIATE=on`, the web restarted), `offers`, `links` (→ `/etc/afflino/amazon/links.csv`; refused while `/privacy` is the stub), `shop` (`WEB_PLACEMENT_ID`, the shop's token minted in the api container, the web restarted; the same privacy condition), `import` (every new earnings download in `/etc/afflino/amazon/reports/`), `returns` (the returns an import could not match: a numbered choice each), `check` (counts and one `/r/` link's `Location`), `pause` / `resume` (the programme's kill switch). Each runs the api image's Amazon CLI (`node dist/cli/amazon.js`) with the files mounted read-only; nothing secret reaches a command line |

The owner's lines (each one complete, as root on the Linode):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
bash /opt/afflino/affiliate/deploy/linode/godaddy-dns.sh
bash /opt/afflino/affiliate/deploy/linode/backup.sh manual
bash /opt/afflino/affiliate/deploy/linode/restore.sh
bash /opt/afflino/affiliate/deploy/linode/amazon.sh keys
```

(`amazon.sh`'s other steps, in order, and the lines on the Mac:
`docs/runbooks/deploy.md` §1A.)

The first line is also the update: run it again whenever the branch has new
commits. It keeps every value in the environment file, stops (changing
nothing) when the checkout has local changes, takes a backup before an
update that changes the code or the environment file, keeps the release
before as `afflino-previous` (rollback: `docs/runbooks/deploy.md` §3),
rebuilds, runs the migrations before recreating anything (a failure leaves
the running services as they were), and leaves running containers alone
when nothing changed.

## Design notes

- **One function, called on the last line** (`main "$@"; exit`): bash has
  read the whole script before it runs, so a `git merge` that rewrites the
  file mid-run cannot change what runs.
- **The rest of the run is the checkout's copy**: the owner's line runs
  whatever raw.githubusercontent.com served (from `/dev/fd/63`; the file is
  cached for up to 5 minutes, `cache-control: max-age=300`), which can be
  older than the commit the code step just checked out. So after the code
  step the script re-executes the checkout's `install.sh` once
  (`AFFLINO_REEXECED=1`), also when a run started from the checkout's copy
  and the update changed it, and hands over the commit the run started
  from (`AFFLINO_HEAD_BEFORE`), so the re-executed pass still takes the
  pre-update backup. The ACME question is asked after that point, once.
- **A server of its own**: preflight refuses a machine where Docker already
  runs another compose project (any `com.docker.compose.project` label but
  Afflino's), whether or not that stack currently holds 80/443, because the
  installer also sets ufw, fail2ban, sysctl and swap for the whole server.
- **Migrations first**: `docker compose build`, then `run --rm migrate` on
  its own, then `up -d`. A failed migration stops the run before any
  container is recreated, so api, redirect, workers and web keep the release
  that ran before.
- **The rollback point** is a local git tag, `afflino-previous`, moved to
  the old commit at every update that changes the code (and written to
  `/etc/afflino/previous-release`); the runbook's §3 line checks it out and
  rebuilds.
- **The environment file is the only source of the stack's variables**:
  every compose call runs with the contract's variables (`.env.prod.example`)
  removed from its environment, so a value exported in the shell cannot win
  over the file.
- **Builds without provenance attestations** (`BUILDX_NO_DEFAULT_ATTESTATIONS=1`):
  with Docker's containerd image store (the default of a fresh Docker 29
  install), an attestation made every build would give an unchanged image a
  new id and compose would recreate every service on every run.
- **The edge restarts only when its Caddyfile changed** after it started
  (Caddy reads the file once; a bind-mounted file replaced by git is not
  even seen by a running container).
- **Ports**: the edge runs with host networking, so it is the only listener
  on 80/443 and ufw applies to it; api, redirect and web publish on
  127.0.0.1 only (Docker's published ports bypass ufw).

## Test-only settings

For rehearsing the scripts on a machine that is not the Linode (they are
never needed there): `AFFLINO_SKIP_SYSTEM=1`, `AFFLINO_SKIP_DOCKER_INSTALL=1`,
`AFFLINO_SKIP_FIREWALL=1`, `AFFLINO_SKIP_SWAP=1`, `AFFLINO_SKIP_GIT=1`,
`AFFLINO_STOP_AFTER=preflight|system|code|env`, `AFFLINO_DIR`,
`AFFLINO_ENV_FILE`, `AFFLINO_PROJECT`, `AFFLINO_BACKUP_DIR`,
`AFFLINO_EDGE_TEST=1` (the edge on plain HTTP, 127.0.0.1:8088),
`AFFLINO_EXTRA_COMPOSE_FILE`, `AFFLINO_ALLOW_OTHER_STACKS=1` (run beside
other compose projects), `AFFLINO_PUBLIC_IPV4` / `AFFLINO_PUBLIC_IPV6`,
and any `.env.prod.example` variable preset in the environment (written
into a new environment file instead of generated or asked; ignored, with a
note, once the file has it). `godaddy-dns.sh` also takes
`AFFLINO_GODADDY_API`, `AFFLINO_DNS_DOMAIN` and `GODADDY_API_KEY` /
`GODADDY_API_SECRET` (an empty secret = a personal access token; never type
a real key on a command line). Each script's header lists its own.

`amazon.sh` takes `AFFLINO_DIR`, `AFFLINO_ENV_FILE`, `AFFLINO_PROJECT`,
`AFFLINO_EDGE_TEST`, `AFFLINO_EXTRA_COMPOSE_FILE` as above, plus
`AFFLINO_AMAZON_DIR` (instead of `/etc/afflino/amazon`),
`AFFLINO_REDIRECT_URL` (where `check` asks the redirect, default
`http://127.0.0.1:3001`), `AFFLINO_WEB_URL` (where `links` / `shop` read
`/privacy`, default `http://127.0.0.1:3002`),
`AFFLINO_AMAZON_ALLOW_TEST_VALUES=1` (the CLI runs with
`NODE_ENV=development`, so it accepts the TEST values `demo-21`, `B0DEMO…`
that it refuses under the image's `NODE_ENV=production`) and
`AFFLINO_AMAZON_SKIP_PRIVACY_CHECK=1` (`links` / `shop` run while `/privacy`
is the stub); its prompts read standard input, so a rehearsal pipes the
TEST answers in.

## What was checked (2026-09-29, in the sandbox)

**`amazon.sh`, after the review fixes of the Amazon.in Associates build**
(2026-09-29, ShellCheck 0.11.0 and 0.9.0 clean): `install.sh` with its
test-only settings on a throwaway project (`afflino-amz3`, `IMAGE_TAG=test`,
the sandbox's CA compose file) — build, `6 migration(s) applied, 0 already
applied`, api, redirect and web healthy — then the TEST example network
seeded, and every step of `docs/runbooks/deploy.md` §1A run through the
script with TEST values, the prompts fed from standard input. `keys`: no
value in the output, the environment file still `root:root 0600`; a Store
ID with "alexa" in it refused, nothing changed; the update line afterwards
changed no container (same ids, start times, image ids and file hash).
`template`: 4 pages (Facebook, Instagram, the two web properties), the
network's YouTube, Snapchat and Telegram accounts left out and counted.
`setup`: refused under the image's `NODE_ENV=production` for the TEST
values, and for a Snapchat row, nothing written; then with
`AFFLINO_AMAZON_ALLOW_TEST_VALUES=1` accepted, `AMAZON_ASSOCIATE=on` set
and the web restarted healthy (the home page's footer: no statement before,
the statement after); a second run added nothing. `offers`: 2 offers, 1
look. `links` and `shop` refused while `/privacy` was the stub page
("afflino.com/privacy is still the stub page …", no link minted); with
`AFFLINO_AMAZON_SKIP_PRIVACY_CHECK=1`: `links` 6 minted, every row with
`#ad · Buy on Amazon.in`; again 0 minted, 6 existing, a byte-identical
sheet; `shop` switched `/shop` to the Amazon look ("See price on
Amazon.in", "Buy on Amazon.in", the statement, "Affiliate links: Yes (we
earn from qualifying purchases)", no "Sponsored" fact, "You complete the
purchase on Amazon.in; Amazon.in's terms apply.", no amazon.in URL in the
HTML). `GET /r/<token>` through the edge: 302 to
`https://www.amazon.in/dp/B0DEMO0002?tag=demo-shop-21`, `X-Robots-Tag:
noindex, nofollow`, no cookie; `facebookexternalhit`, `curl/8.5.0`,
`HeadlessChrome`, no user agent, `Sec-Purpose: prefetch;prerender` and
HEAD got the preview page (200, no click, no tagged URL). `import`: the
TEST earnings report 4 rows (2 by tracking ID, 2 to suspense); again: 4
already imported; a changed fee refused (409) with nothing written; the
TEST return applied; an ambiguous return listed as unmatched, then
`returns` offered its two candidate sales and applied the one typed (`2`),
and a second `returns` found nothing left; the ledger balanced (INR 51984 /
51984). `check` → 302 with the shop page's tag; `pause` → the paused page,
`links` refused; `resume` → 302 again. The update line at the end changed
nothing. Then `down -v`: no container, volume or network of the project
left. Output: `docs/runbooks/deploy.md` §1A, "Rehearsed 2026-09-29".

**Before the review fixes** (the first Amazon rehearsal, project
`afflino-amz`): the same steps without the privacy gate, the returns step
or the platform limit; superseded by the run above.

**Earlier (the installer itself):**

Re-checked after the review fixes (the latest script versions):

- `install.sh` as the owner's line runs it (`bash <(…)`, on a pty) with
  `AFFLINO_SKIP_SYSTEM=1 AFFLINO_SKIP_GIT=1 AFFLINO_EDGE_TEST=1`, a
  throwaway project and an extra compose file for the sandbox's CA: the
  new ACME prompt (account and policy notices; Enter skipped it), the
  environment file `root:root 0600` in a 0700 directory, the four secrets
  64 / 96 / 64 / 64 hex characters and none of them (whole or a 16-character
  prefix) in the output or any container log; `build`, then the migrations
  on their own (`5 migration(s) applied`), then `up`; api, redirect and web
  healthy; the edge answered. A second run (no terminal, `JWT_SECRET` set in
  the shell): "kept the file's JWT_SECRET", the file's hash and mtime
  unchanged, every container the same id and start time but the one-shot
  migrate, the same image ids, no pre-update backup. Through the edge:
  `/r/<token>` 302 with `subid` and no `set-cookie`; with `X-Forwarded-For`,
  `X-Real-IP`, `Forwarded`, `True-Client-IP`, `CF-Connecting-IP` and
  `X-Client-IP` spoofed, `ip_hash` = HMAC(`IP_HASH_KEY`, 127.0.0.1) and no
  spoofed value; 0 log lines with an address; www → 301 with path and query;
  HSTS / nosniff / Referrer-Policy / DENY, no `Server`; both `SITE_INDEXING`
  states through the documented sed + installer line (on: robots.txt open,
  a sitemap of `/` and `/shop`, the TEST look and item pages
  `noindex, nofollow`, and a pre-launch notice that was removed later the
  same day once the owner confirmed the figures; off: `Disallow: /`); with the web stopped a 502 carrying the security headers
  and no `Server`; a 5 MB body → 413 with them; a `CONNECT` → 502 with them.
- A failing migrate command (an extra compose file) stopped the run at the
  migrations ("Nothing was recreated"): every container kept its id, state
  and start time and the site kept answering; the next normal run went on.
- The dedicated-server guard: another project's run stopped at preflight
  naming the running compose project; `AFFLINO_ALLOW_OTHER_STACKS=1` turned
  that into a warning (the port guard then still stopped it on 8088 and
  127.0.0.1:3000–3002). The python port check (used where `ss` is missing)
  no longer mistakes a port with only closed (TIME_WAIT) connections for a
  listener, and still refuses a real one.
- The code step against the public repository (a sparse clone reset to
  296b392, the curl form of this `install.sh`): `updated 296b392 → f7046bd;
  the release before is kept as the git tag afflino-previous`, the tag and
  `previous-release` written, then "continuing with the checkout's copy of
  the installer" and a second pass from the checkout's copy; the
  re-executed pass of this version (`AFFLINO_REEXECED=1
  AFFLINO_HEAD_BEFORE=296b392…`) printed "this run updates 296b392 →
  f7046bd", the condition of the pre-update backup. Refusals: the detached
  checkout after a rollback and a local edit, each with a complete
  one-line way back; a non-root user ("log in … as root (or run sudo -i
  first)").
- `restore.sh --replace-live` (typed `REPLACE` on a pty): with a link
  cached in Redis and a dump that predates it, "cleared the redirect's
  route cache in Redis (1 route:* key(s))" and the link then 404 (without
  the clear it would have kept redirecting from the cache); the seeded dump
  restored back → the link 302 again. The restore check: PASS.
- `godaddy-dns.sh` against a local stand-in: a token with an empty secret
  went as `Bearer`, a key and secret as `sso-key` (both through the hidden
  prompts on a pty and through the environment); the 403 text names the
  missing DNS scope; the 401 text covers both kinds; the token, key and
  secret appeared 0 times in the terminal output.
- ShellCheck 0.11.0 and 0.9.0 and `bash -n`: clean on all four scripts.

Earlier (the first rehearsal of the scripts):

- `bash -n` and ShellCheck 0.11.0 and 0.9.0 (the version on CI's
  ubuntu-latest image): clean on all four scripts (CI runs both checks on
  every change).
- `install.sh` with `AFFLINO_SKIP_SYSTEM=1 AFFLINO_SKIP_GIT=1
  AFFLINO_EDGE_TEST=1`, a throwaway project, a scratch environment file and
  an extra compose file that builds from the sandbox's CA-carrying node
  image: environment file created `root:root 0600` with the four secrets
  generated (64 / 96 / 64 / 64 hex characters), `SITE_HOST`,
  `SITE_INDEXING=off`, `ACME_EMAIL` (preset empty); images built; migrate
  exited 0; api, redirect and web healthy; the edge answered through
  127.0.0.1:8088 and listened nowhere else (not on the host's other address,
  not on 80, no admin API on 2019); status printed. A second run: environment
  file byte-identical (same hash and mtime; `ACME_EMAIL` and `JWT_SECRET`
  presets in the shell ignored, with a note), all seven long-running
  containers the same ids and start times, the same image ids; only the
  one-shot migrate ran again (`0 migration(s) applied, 5 already applied`).
  A removed key was added back (and a pre-update backup taken); a Caddyfile
  edited after the edge started restarted the edge once, and the next run
  did not. Torn down afterwards: no container, volume, network or image left.
- Through that stack: canonical `https://afflino.com`, `noindex, nofollow`,
  robots.txt `Disallow: /`, HSTS / nosniff / Referrer-Policy /
  `X-Frame-Options: DENY`, no `Server`, www → 301 with path and query, a
  5 MB body → 413; the TEST network seed, the shop token, mint-links
  (`minted=1 ... failed=0`); the look page's `https://afflino.com/r/<token>`
  → 302 with `subid`, no cookie; with `X-Forwarded-For`, `X-Real-IP` and
  `Forwarded` spoofed, both clicks' `ip_hash` = HMAC(`IP_HASH_KEY`,
  127.0.0.1), the address the host-networked edge really saw (with the
  bridge-networked edge of the earlier rehearsal it was the compose
  gateway's), and not the HMAC of the gateway or of any spoofed address.
- `backup.sh`: dumps written 0600 and checked; rotation kept the newest N;
  a pg_dump that dies half-way or ends without its closing line leaves no
  file (a stand-in `docker`). `restore.sh`: PASS on a dump with TEST ledger
  rows (INR debits 16000 = credits 16000), FAIL on one with an unbalanced
  row; `--replace-live` refused anything but `REPLACE`; a dump that does not
  load stopped before the swap with the live database untouched and no
  staging database left; the good dump replaced the live database (a table
  created after the dump was gone, 3 clicks back to 2 in an earlier run),
  web / api / redirect / workers healthy again, and the next installer run
  changed nothing.
- In a throwaway `ubuntu:24.04` container: the system step installed every
  package (`ca-certificates curl git ufw fail2ban python3-systemd
  unattended-upgrades openssl iproute2 python3 gzip`) and wrote the
  unattended-upgrades, fail2ban and sysctl files; a second run found them
  installed; refused: port 80/tcp and
  443/udp held by another program (named by `ss`), Debian 11, a non-root
  user; Debian 12 accepted. The code step against the public repository:
  sparse clone of `affiliate/`, "up to date" on the next run, fast-forward
  when behind, and refusals (nothing changed) for a local edit, a detached
  HEAD, a local commit and a non-git directory.
- `godaddy-dns.sh` against a local stand-in for the GoDaddy API: parking
  `A` records replaced, `AAAA` added, the `www` CNAME kept; a re-run changes
  nothing; a personal access token works; `AAAA` removed for a server
  without IPv6; clear stops on 401, 403 (the 10-domain / Discount Domain Club
  rule), 404 and 422; the key never appeared in any process's arguments.

Not checkable from the sandbox: the real Linode (Docker from get.docker.com,
ufw, fail2ban and the timer under systemd, the swapfile), GoDaddy's real API,
Let's Encrypt, and IPv6 (the sandbox kernel has none: that the host-networked
edge sees real IPv6 client addresses follows from Caddy owning the socket,
not from a test).
