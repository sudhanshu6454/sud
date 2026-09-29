# Marketing fleet: standing rules

Rules the owner has set for the content this repository publishes. They apply to every site and every
social channel, and each has a test or a setting behind it; change the code, not just the note.

## Cinema clips: 30 seconds, never more (trailers excepted)

A cinema clip (a scene, a song, a monologue, any film footage fetched from YouTube) is never posted
longer than **30 seconds**, on the website, as a reel, or as a Facebook video. The one exception is a
trailer, which keeps the ad-clip limit. Enforced by `settings.scene_clip_max_seconds` and
`adclip.trim` in `autopub/autopub/scenes.py`; the article's YouTube embed of the original is not
our hosting and may be the full clip.

## Type never sits on a face

Every renderer keeps its type off people's faces: the crop moves the subject, the type moves to the
clear band, or the type-only card stands in. `tests/test_no_text_on_faces.py`.

## High quality, always

Fetch the largest copy of a still, enhance once, save at JPEG 90 with full chroma, encode video at
CRF 18. A still too small to fill a 3:4 poster is letterboxed, not blown up.

## Filmybuff is curated, not a wire

filmybuff.com and its Instagram carry the same 3:4 poster, built on an original frame from the film
(TMDB), in the print-grade look with cream type. The day is the formats (deep dives, watchlists and
ranked lists, trailers, scenes) and the news post is held to `news_hours`. Scenes start from what is
already viral on YouTube, on rights holders' channels only, and the page breaks the scene down beat
by beat.

## Operations

Secrets are entered through hidden prompts, never printed. Commands given to the owner are single
lines with no placeholders; the server has no `make`, no node, no `dig`. Rebuild with
`cd /opt/marketing-fleet && git fetch origin && git merge --ff-only origin/claude/wordpress-multisite-auto-publish-o2zlsd && docker compose up -d --build --remove-orphans`
and ship themes with `./infra/wp/deploy-themes.sh`.

## OpenSEO

OpenSEO runs beside the fleet (`openseo` service, loopback and internal network only, no app auth).
autopub asks it for target keywords before every news article and can track rankings
(`python -m autopub seo ...`). Works for all five sites. Its UI is reached over 
`ssh -L 3001:127.0.0.1:3001 root@SERVER`; the repo's `.mcp.json` points Claude Code at it 
through that tunnel. Never expose port 3001 publicly.

## Google Search Console

Google Search Console (GSC) MCP server (`mcp-search-console`) integrated for SEO analysis across
all five sites: Filmybuff, Crazy4Marketing, ScreenStat, Marketing Mentalist, Marketing Junkies.
Use it to:
- Track which queries bring visitors to each site
- Monitor indexing status of published pages
- Analyze click-through rates (CTR) and impressions
- Compare performance between time periods and sites
- Inspect URLs for indexing issues
- Identify new keyword opportunities

First auth: Call `get_capabilities` to trigger OAuth browser flow. Uses your Google account.
See SEO_INTEGRATION.md for the complete setup guide and usage examples for all five sites.


## GEO Optimizer

GEO Optimizer (Generative Engine Optimization) MCP server ensures all published content is visible 
and citable by AI answer engines: ChatGPT, Perplexity, Gemini, Claude, Google AI Overviews. Use it to:
- Audit sites for AI visibility (0-100 score)
- Generate and validate llms.txt, schema markup, robots.txt rules
- Check if AI engines actually cite your content
- Compare AI readiness across all five sites
- Identify and fix content citability issues

Run `geo_audit` on each domain after publishing to verify AI visibility. Fix recommendations are 
auto-generated (llms.txt, JSON-LD schema, bot access rules). See GEO_OPTIMIZER.md for examples.

## Affiliate platform

The affiliate platform lives in `affiliate/` (pnpm monorepo: `packages/{shared,api,redirect,workers,web}`,
`db/`, `docker/`, `docs/`) and runs beside the fleet behind the `affiliate` compose profile with the
`AFFILIATE_*` block of `.env`; the owner's `docker compose --profile affiliate …` lines are in
`README.md` ("Affiliate platform"), and the `make affiliate-*` targets are those same lines for a
machine that has `make`. `affiliate/CLAUDE.md` and its eleven invariants apply to any change under
`affiliate/` (integer minor units, append-only double-entry ledger, every query tenant-scoped,
idempotent ingest, never-guessed attribution, maker-checker payouts, TEST-labelled seed data). Test
with `cd affiliate && ./node_modules/.bin/vitest run` (133 tests; a dev machine or CI — the server has
no node). Never write an AI model name or identifier into a file there.

Two rules hold fleet-wide, on the shop, on the sites, in bios and captions:

- **The consumer never receives a raw merchant URL.** Every shoppable call-to-action is the tracked
  link `/r/{token}` on the affiliate link host, minted by `POST /v1/links`; the API never returns
  `offers.offer_url` and the shop renders a visibly disabled control when no link exists.
  `affiliate/packages/api/test/catalogue.test.ts` asserts no merchant host appears in any response.
- **The shop's API token is server-only.** `AFFILIATE_WEB_API_TOKEN` reaches the web container as
  `WEB_API_TOKEN`, is read only by server code (`affiliate/packages/web/lib/server-env.ts`), is never
  `NEXT_PUBLIC_`, never in the browser bundle, never forwarded through the `/api` proxy.
