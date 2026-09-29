# deploy/linode — afflino.com on the owner's Linode

Four bash scripts, run as root on the Linode (Ubuntu 24.04 recommended;
Ubuntu 22.04 and Debian 12 accepted). The server needs nothing installed
first: no make, no node, no dig; bash, curl and python3 come with the image.
The procedure around them (DNS, checks, rollback, the kill-switch drill) is
[`docs/runbooks/deploy.md`](../../docs/runbooks/deploy.md); the overview is
README.md "Deploying afflino.com on Linode".

| Script | What it does |
|---|---|
| `install.sh` | Install, and every later run update: preflight, system (packages, Docker, ufw, fail2ban, unattended upgrades, swap on small plans), the code in `/opt/afflino`, the secrets in `/etc/afflino/afflino.env` (generated, never printed), `docker compose up -d --build`, health, the DNS status, the daily backup timer |
| `backup.sh` | `pg_dump` inside the postgres container → `/var/backups/afflino/afflino-<UTC time>-<kind>.sql.gz` (0600, checked, the 14 newest of each kind kept); run daily at 02:30 UTC by `afflino-backup.timer` |
| `restore.sh` | Default: restores the newest dump into a scratch database and checks it (migrations, tables, row counts, the ledger balanced per currency), the live database untouched. `--replace-live`: after you type `REPLACE`, takes a pre-restore backup, loads the dump into a staging database (a failed load changes nothing), then swaps it in while web, api, redirect and workers are stopped for a few seconds |
| `godaddy-dns.sh` | Optional, needs GoDaddy API access: sets `A @` and `AAAA @` for afflino.com to this server, keeps the `www` CNAME, prints before / after. Hidden prompts; the keys are never stored |

The owner's lines (each one complete, as root on the Linode):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
bash /opt/afflino/affiliate/deploy/linode/godaddy-dns.sh
bash /opt/afflino/affiliate/deploy/linode/backup.sh manual
bash /opt/afflino/affiliate/deploy/linode/restore.sh
```

The first line is also the update: run it again whenever the branch has new
commits. It keeps every value in the environment file, stops (changing
nothing) when the checkout has local changes, takes a backup before an
update that changes the code or the environment file, rebuilds, and leaves
running containers alone when nothing changed.

## Design notes

- **One function, called on the last line** (`main "$@"; exit`): bash has
  read the whole script before it runs, so a `git merge` that rewrites the
  file mid-run cannot change what runs. When the update changes
  `install.sh` itself and the run started from the checkout's copy, it
  continues with the new version (once).
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
`AFFLINO_EXTRA_COMPOSE_FILE`, `AFFLINO_PUBLIC_IPV4` / `AFFLINO_PUBLIC_IPV6`,
and any `.env.prod.example` variable preset in the environment (written
into a new environment file instead of generated or asked; ignored, with a
note, once the file has it). `godaddy-dns.sh` also takes
`AFFLINO_GODADDY_API`, `AFFLINO_DNS_DOMAIN` and `GODADDY_API_KEY` /
`GODADDY_API_SECRET` (never type a real key on a command line). Each script's
header lists its own.

## What was checked (2026-09-29, in the sandbox)

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
