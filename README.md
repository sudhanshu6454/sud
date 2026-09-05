# Marketing Fleet – hands-free WordPress news sites

Three (soon five) WordPress sites on one Linode, each automatically curating marketing news from
the internet, publishing original articles, and syndicating every article to all of its social
accounts with a generated share image. No human in the loop after setup.

| Site | Key | Beat |
|------|-----|------|
| marketingmentalist.in | `MENTALIST` | Consumer psychology, branding, persuasion |
| crazy4marketing.com   | `CRAZY`     | Digital / performance marketing, growth, AI in marketing |
| marketingjunkies.in   | `JUNKIES`   | Marketing, media, martech industry news |

Domains are at GoDaddy, hosting is on Linode. Everything is defined in `autopub/config/sites.yaml`.

## How it works

```
 RSS feeds + Google News ─► dedupe (SQLite) ─► fetch & extract article text (trafilatura)
        │
        ▼
 Claude (claude-opus-5, structured JSON) writes an ORIGINAL 450-750 word article with
 attribution + SEO title/excerpt/tags + a platform-specific caption for every network
        │
        ▼
 Pillow renders branded share images: 1200×630 (landscape) and 1080×1080 (square)
        │
        ▼
 WordPress REST API: upload images, set categories/tags, publish with featured image
        │
        ▼
 Fan-out to socials, each in the shape that platform supports:
   image + clickable link   X/Twitter, Facebook Page, LinkedIn Page, Pinterest, Telegram, Threads
   image only (link as text) Instagram
```

Every step is isolated: a failing feed, a declined rewrite, or one social API being down never
blocks the other sites or platforms. The scheduler (`autopub serve`) runs every 2 hours by default,
publishes up to N new stories per site per run, and spreads posts out so social feeds are not spammed.

Repository layout:

```
autopub/            Python service (curation → WordPress → socials) + tests
  config/sites.yaml   the fleet definition: domains, beats, feeds, brand colours, socials
infra/
  gen_compose.py      generates docker-compose.yml from sites.yaml
  linode/provision.sh one-shot: create Linode → DNS → deploy → install WordPress
  dns.py              GoDaddy (or Linode) DNS records for every domain
  bootstrap.sh        server-side: compose up + WordPress install
  wp/init-sites.sh    wp-cli: install core/theme/plugins, create autopub user + app passwords
docker-compose.yml  nginx-proxy + Let's Encrypt, MariaDB, 3× WordPress, autopub worker
```

## Quick start (from your laptop)

Requirements: `ssh`, `rsync`, `python3` with `pyyaml` and `requests`, a Linode API token, GoDaddy API keys
(or use Linode DNS, see below), an Anthropic API key, and the social app credentials you want to use.

```bash
git clone https://github.com/sudhanshu6454/sud && cd sud
cp .env.example .env          # fill in: passwords, ANTHROPIC_API_KEY, LINODE_TOKEN, GoDaddy keys, socials
export LINODE_TOKEN=...
./infra/linode/provision.sh   # ~10 minutes
```

`provision.sh` creates a 4 GB Linode in Mumbai (`ap-west`, change with `LINODE_REGION`), points the A records
of all domains at it, installs Docker, syncs this repo to `/opt/marketing-fleet`, starts the stack, installs
WordPress on every site (theme, SEO plugin, cache plugin, permalinks), creates an `autopub` author with an
Application Password per site, writes those passwords back into `.env`, and starts the publisher. HTTPS
certificates are issued by Let's Encrypt automatically once DNS has propagated.

Social credentials can be added later: put them in `.env` on the server and run `docker compose up -d autopub`.
Platforms without complete credentials are simply skipped (see `make check`).

### Already have a server?

```bash
ssh root@SERVER 'mkdir -p /opt/marketing-fleet'
rsync -az --exclude .git ./ root@SERVER:/opt/marketing-fleet/ && scp .env root@SERVER:/opt/marketing-fleet/
python3 infra/dns.py --ip SERVER_IP
ssh root@SERVER 'cd /opt/marketing-fleet && ./infra/bootstrap.sh'
```

## Day-to-day operations (on the server, in `/opt/marketing-fleet`)

```bash
make check      # WordPress login + which socials are wired, per site
make sources    # what the feeds offer right now
make run        # publish one cycle immediately
make status     # what has been published, with links and any errors
make logs       # follow the publisher
```

Tuning lives in `sites.yaml` (`settings:` block and per-site `max_posts_per_run`, `max_age_hours`, feeds,
keywords). After editing: `make up` (the config is mounted into the container, a restart is enough).

## Adding site 4 and 5

1. Add a block to `autopub/config/sites.yaml` with a new `key` (e.g. `GROWTH`), domain, beat, feeds, colours.
2. Add `WP_GROWTH_DB_PASSWORD` and the social variables (`TWITTER_GROWTH_*`, …) to `.env`.
3. `make compose` (regenerates `docker-compose.yml` with the new WordPress + DB), then on the server:
   `python3 infra/dns.py --ip SERVER_IP --domain newdomain.com`, `make up`, `make init`.

The MariaDB init script only runs on first start; for a new site on an existing server create the database once:

```bash
docker compose exec db mariadb -uroot -p"$DB_ROOT_PASSWORD" -e \
 "CREATE DATABASE wp_growth; CREATE USER 'wp_growth'@'%' IDENTIFIED BY '<WP_GROWTH_DB_PASSWORD>'; GRANT ALL ON wp_growth.* TO 'wp_growth'@'%';"
```

## Getting the social credentials

All variables are `PLATFORM_<SITEKEY>_NAME` in `.env`. Each site can have its own accounts.

| Platform | Variables | Where to get them |
|----------|-----------|-------------------|
| X / Twitter | `TWITTER_*_API_KEY`, `API_SECRET`, `ACCESS_TOKEN`, `ACCESS_SECRET` | developer.x.com → project app with **Read and Write** permissions → generate user access token/secret. Free tier allows posting. |
| Facebook Page | `FACEBOOK_*_PAGE_ID`, `PAGE_TOKEN` | developers.facebook.com app → Graph API Explorer → permissions `pages_manage_posts`, `pages_read_engagement` → exchange for a **long-lived Page** token. |
| Instagram | `INSTAGRAM_*_USER_ID`, `ACCESS_TOKEN` | Instagram Business/Creator account linked to the Facebook Page; same app with `instagram_basic`, `instagram_content_publish`. User ID = the IG business account id. Images must be publicly reachable (we use the WordPress media URL). |
| LinkedIn Page | `LINKEDIN_*_ORG_URN`, `ACCESS_TOKEN` | LinkedIn Developer app with **Community Management API** (`w_organization_social`). URN format `urn:li:organization:123456`. Tokens last 60 days; renew via refresh token. |
| Pinterest | `PINTEREST_*_ACCESS_TOKEN`, `BOARD_ID` | developers.pinterest.com app with `pins:write`, `boards:read`. |
| Telegram | `TELEGRAM_*_BOT_TOKEN`, `CHAT_ID` | @BotFather → new bot; add it as admin of your channel; `CHAT_ID` is `@channelname`. |
| Threads | `THREADS_*_USER_ID`, `ACCESS_TOKEN` | developers.facebook.com → Threads API use case → `threads_basic`, `threads_content_publish`; long-lived token. |

Meta and LinkedIn tokens expire. When a platform starts failing, `make status` shows the error; refresh the
token in `.env` and `docker compose up -d autopub`.

## Notes and known limitations

- **Content policy.** The model is instructed to write original coverage, never copy sentences, and to
  end every article with a linked source attribution. Facts come from the source text only. Review the
  `SYSTEM_PROMPT` in `autopub/autopub/rewrite.py` if you want a different editorial stance.
- **GoDaddy API** access is limited to accounts with 10+ domains or a Discount Domain Club plan. If
  `infra/dns.py` returns 403, run it with `--provider linode`: it hosts the zones on Linode DNS and tells you
  which nameservers to set at GoDaddy (or sets them for you if the GoDaddy keys work).
- **Google News RSS** links are encoded; the decoder handles the classic format and skips links it cannot
  resolve, so direct publisher feeds are the primary source. Add or remove feeds freely in `sites.yaml`.
- **Instagram** does not allow clickable links in captions; the article link is added as text and the caption
  says "link in bio". Point the bio link at the site.
- **Cost.** Each article is one Claude call with a cached system prompt (roughly 6-10k input tokens, 2-3k
  output). Change `llm_model` / `llm_effort` in `sites.yaml` or `ANTHROPIC_MODEL` in `.env` if needed.
- **Server-side refusal fallbacks** are enabled for the Claude calls (`fallbacks: "default"`); if the API
  rejects the parameter the client transparently retries without it. Set `ANTHROPIC_FALLBACKS=off` to disable.
- **Backups.** All persistent data lives in Docker volumes (`db_data`, `wp_*_data`, `autopub_data`). Enable
  Linode Backups on the instance, or snapshot volumes with `docker run --rm -v <vol>:/v -v $PWD:/b alpine tar czf /b/<vol>.tgz /v`.

## Development

```bash
cd autopub && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
AUTOPUB_CONFIG=config/sites.yaml AUTOPUB_DATA_DIR=./data .venv/bin/python -m autopub sources --site CRAZY
```

CI (GitHub Actions) runs the tests, checks that `docker-compose.yml` matches `sites.yaml`, and validates the compose file.
