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

### No SSH available? Deploy through cloud-init only

```bash
python3 infra/linode/deploy.py          # needs LINODE_TOKEN, ANTHROPIC_API_KEY, WP_ADMIN_EMAIL in .env
```

This creates the Linode with a cloud-init that clones this (public) repository, writes the `.env`, and runs the
full bootstrap on first boot; DNS zones are created on Linode DNS. Missing passwords are generated into `.env`.
Then set each domain's nameservers at GoDaddy to `ns1.linode.com` … `ns5.linode.com`. Progress is logged on the
server in `/var/log/marketing-fleet-bootstrap.log`.

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

## Custom site themes

`themes/marketing-mentalist` is a full WordPress theme for marketingmentalist.in: Modernist
system in the brand's ink/paper/bone/signal palette, Instrument Sans + Literata + Courier Prime.
It ships its own content model - custom post types for Campaigns, Breakdowns, Mentalist Takes,
Brands, Agencies, Brand Battles and Top Lists, plus the shared taxonomies (industry, campaign
type, psychology principle, objective, platform, emotion, market) - built by editors in wp-admin,
independent of autopub. The `post` type (News) is untouched, at its existing root URL, so autopub
keeps publishing exactly as it does on the other two sites.

What it includes: the homepage's eleven modules (hero, trending ticker, swipe-the-strategy
carousel, breakdowns, Mentalist take, latest campaigns with type filters, psychology lab, brand
battle, news + top lists, newsletter, get-featured), reorderable from Appearance → Homepage
Modules; the campaign detail page (sticky "Decode" table of contents, six structured sections,
credits, asset carousel, related campaigns); the breakdown article page (reading-progress bar,
sticky TOC, popular sidebar, sponsor slot); brand/agency pages; a faceted campaign archive; a
full-screen search overlay; a public "submit a campaign" form and an "advertise" page with
Customizer-editable media-kit numbers; NewsArticle/CreativeWork/Organization schema; `/llms.txt`
and `/llms-full.txt`; a read-only `/wp-json/mm/v1/campaign/{slug}` endpoint; and GA4 `dataLayer`
events for shares, signups, search, filters and the (static, per the brief's v1 scope) brand
battle vote.

Two deliberate substitutions for the original design-handoff spec, both to avoid plugin
dependencies for content the theme owns: ACF field groups became native postmeta with plain
meta-box editors (repeaters are one `field|field|field` per line, documented on the field), and
the Fluent Forms submission form became a native handler that stores submissions as a private
`mm_submission` post and emails the site admin. Not built in this pass: the static component
library page (design screen 3a - a design reference, not a page real users visit) and the full
13-event GA4 catalog beyond what the templates already fire events for.

Verified end to end the same way as marketing-junkies: a real WordPress + SQLite install, every
custom post type seeded with content (including a sponsored campaign), every template rendered
and checked for PHP errors, and the rendered pages checked against the design's screens 1a-1d at
both breakpoints. That pass caught and fixed four real bugs - a crash when a post has no terms
(`(array) false` is `[false]`, not `[]`, in PHP), the primary nav rendering as a vertical list
(flex was on the wrong element), the mobile sticky share pill showing on desktop, and inline
`style="display:..."` beating the `.mm-only-desktop` responsive utility's specificity.

`themes/marketing-junkies` is a hand-built WordPress theme for marketingjunkies.in, matching the
brand's cream/ink/bronze palette and Archivo type (Modernist design system). It renders the exact
fields autopub publishes (title, excerpt, category, tags, 1200x630 featured image, source
attribution) on the homepage, single articles, category/tag archives and search, with a sticky
table of contents generated from the article's headings, FAQ and NewsArticle schema, an
`/llms.txt` for AI crawlers, a built-in newsletter capture (Subscribers menu in wp-admin, or point
it at an external provider from Appearance → Customize → Marketing Junkies → Newsletter), and ad
slots that render nothing until a tag is pasted into that same Customizer panel. Mark any post
"sponsored" by tagging it `sponsored` in the editor; the theme adds the disclosure banner and
`rel="sponsored"` on outbound links automatically — autopub itself never marks a post sponsored.

`themes/crazy4marketing` is a pre-built WordPress theme supplied for crazy4marketing.com: a dark
editorial design (Core Black / Signal Pink / Paper Cream, Space Grotesk) with a breaking-news
ticker, a homepage hero + secondary leads + numbered category rails + a "Hot Take" pull-quote
break + latest grid + trending/newsletter sidebar + Instagram strip, single-article pages with
share/copy-link and a related-stories rail, faceted-free category archives with a most-read
sidebar, search, 404, and an About/Contact template. It uses core `post`s and `category`s (no
custom post types), so autopub publishes to it exactly as it does on the other two sites; the
homepage rails, "Hot Take" section and ticker are driven by category slugs set in Appearance →
Customize → Crazy4 Marketing, which `init-sites.sh` points at the site's real `sites.yaml`
categories automatically (falling back to the theme's own News/Viral/Brands/Trends/Hot
Takes/Insights/Breaking naming if you create those categories instead). No changes were needed to
the theme's PHP - it was verified as-is against a real WordPress + SQLite install (every template,
both breakpoints, mobile menu, real seeded categories/images) and had zero PHP warnings or notices.

`infra/wp/init-sites.sh` installs each of these themes automatically for its site (the
`LOCAL_THEMES` map near the top of that script) and copies fresh files into the container on every
run, so editing a theme and re-running `./infra/wp/init-sites.sh` (or `make init`) updates the live
site. To give another site its own theme the same way, add a `themes/<name>` directory and a
`[KEY]="<name>"` entry to that map.

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
