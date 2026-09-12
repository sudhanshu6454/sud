# pulse-worker

The ingestion worker for **Screenstat Pulse**. It pulls a film's signals from public and owned APIs, converts them into the units the Pulse model expects, and either posts them to the `screenstat-pulse` WordPress plugin or writes a payload file you can paste into the Pulse UI's *Data sources → Import* box today.

Zero npm dependencies. Node 20 or newer. Secrets live only in `.env`.

| Connector | Signals | Needs | Cadence |
|---|---|---|---|
| `wikimedia` | `wiki` | nothing (public) | daily |
| `trends-rss` | `trending` event | nothing (public) | every 30 min |
| `youtube` | `trTotal`, `likeRatio`, `song`, `tr24`, **`sentiment`** (comments on trailer, teasers, songs) | `YT_API_KEY` | every 6 h; hourly for 48 h after a trailer drops |
| `gsc` | `gsc` | service-account JSON + `GSC_PROPERTIES` | daily |
| `trends` | `search` | `SERPAPI_KEY` (optional driver) | weekly |
| `meta-hashtags` | `posts` | `META_SYSTEM_USER_TOKEN` | every 6 h |
| `meta-network` | `net`, `sentiment` (comments on your pages' film posts) | `META_SYSTEM_USER_TOKEN` + `config/assets.json` | every 6 h |
| `spotify` | `spot` (popularity of the top configured track) | `SPOTIFY_CLIENT_ID/SECRET` | daily |
| `reddit` | `reddit` (threads + comments/day), `sentiment` | `REDDIT_CLIENT_ID/SECRET` | every 6 h |
| `tmdb` | `tmdb` (daily popularity — one scale for every industry) | `TMDB_API_KEY` | daily |
| `trakt` | `antic` (watchlist adds on the anticipated chart) | `TRAKT_CLIENT_ID` | every 6 h |
| `meta-discovery` | `official` (studio, label, platform and star accounts) | `META_SYSTEM_USER_TOKEN` + `IG_SELF_USER_ID` + `config/sources.json` | every 6 h |
| `kobis` | — calibration only (Korean daily box office + reservation rate) | `KOBIS_KEY` | daily |

`bms` (BookMyShow), `imdb`, `adv` (advance tickets — from Sacnilk/trade advance-booking reports) and the trade calls are **not** fetched by the worker — they come from the one-click clipper in the Pulse UI, on purpose (no login, no scraping).

## 1. Install

```bash
cd pulse-worker
cp .env.example .env
cp config/films.example.json config/films.json
cp config/sources.example.json config/sources.json   # 80 official IG accounts, 33 YouTube channel ids
npm test            # 29 tests, all offline
```

## 2. Keys — where each one comes from

**YouTube Data API v3 (free).** Google Cloud Console → create a project → *APIs & Services → Enable APIs* → YouTube Data API v3 → *Credentials → Create credentials → API key*. Restrict the key to the YouTube Data API. Paste into `YT_API_KEY`. Daily quota 10,000 units; this worker uses under 100.

**Google Search Console (free).** Same Cloud project → enable *Google Search Console API* → *Credentials → Service account* → create, then *Keys → Add key → JSON*; save the file as `config/google-service-account.json`. In Search Console, open each property (screenstat.in, bollywoodchronicle.com, movified.co, indenews.in) → *Settings → Users and permissions → Add user* → the service account's e-mail, permission **Full**. List the properties in `GSC_PROPERTIES` exactly as Search Console names them (`sc-domain:screenstat.in` for domain properties, `https://www.example.com/` for URL-prefix ones).

**Meta Graph API (free, needs App Review to leave Development mode).**
1. All 50 Pages in one Business Portfolio; each Instagram account a Professional account connected to one of those Pages.
2. Meta for Developers → create a **Business** app in that portfolio → add *Instagram Graph API* and *Facebook Login for Business*.
3. Business Settings → *System users* → add an Admin system user → assign all Pages and Instagram accounts → *Generate token* with `pages_show_list, pages_read_engagement, pages_read_user_content, read_insights, instagram_basic, instagram_manage_insights, instagram_manage_comments, business_management`. Paste into `META_SYSTEM_USER_TOKEN`.
4. `npm run inventory` → writes `config/assets.json` with every Page and its Instagram account, and lists Pages that have no Instagram account connected.
5. Submit App Review for those permissions with a screencast of Pulse. You do **not** need Page Public Content Access or Public Content Access — everything here runs on assets you own.

**Spotify (free).** developer.spotify.com → Dashboard → Create app (any redirect URI) → copy Client ID and Secret into `.env`. Put each film's track ids in `spotify_track_ids` (the id is the last segment of a track URL). Popularity is Spotify's own 0–100 score — it is relative and recency-weighted, which is exactly what a pre-release signal wants.

**Reddit (free for this volume).** reddit.com/prefs/apps → create a *script* app → Client ID (under the name) and Secret into `.env`. The worker uses client-credentials OAuth and stays under the free rate limit (100 req/min). Subreddits are configurable via `REDDIT_SUBS`.

**TMDB (free).** themoviedb.org → Settings → API → request a key. Either the v3 key or the v4 read token works; the connector detects which. TMDB's `popularity` is a daily traffic-weighted score computed the same way for a Malayalam film and a Marvel film, which is the only public number that puts every industry on one scale. **The free key covers non-commercial use only** — licence the data from TMDB before publishing the figures on screenstat.in, and keep the attribution line the connector returns.

**Trakt (free).** trakt.tv/oauth/applications → create an app → copy the Client ID into `TRAKT_CLIENT_ID`. The worker reads `/movies/anticipated`, whose ranking is watchlist adds: a public, global, pre-release intent count. Trakt's users skew Western and online, so the signal is worth three points out of a hundred — real for a Hollywood release in India, near noise for a Malayalam one.

**Instagram Business Discovery (no extra key).** Uses the same `META_SYSTEM_USER_TOKEN`. Set `IG_SELF_USER_ID` to any `ig_user_id` from `config/assets.json` — Business Discovery queries are made *through* an account you own and answer only for public professional accounts. Then `cp config/sources.example.json config/sources.json` and run `node scripts/discovery-check.js` once: it asks Business Discovery about each of the 80 handles, writes back follower and media counts for the ones that answer, and marks the rest `enabled: false` with the reason. **Do this before trusting the list** — the handles were compiled from public knowledge, and Instagram disallows crawling, so there was no legitimate way to verify them in bulk.

**KOBIS (free).** kobis.or.kr → open API → request a key. This is calibration, not a signal: Korea publishes a daily audited box office *and* a reservation rate — the share of tomorrow's tickets already sold — which is the only public analogue anywhere of what Pulse's advance-booking leg estimates. Run it on a few Korean releases to check that leg against a market that publishes the truth, then apply the method to India, where no one does.

**IMDb datasets (free, non-commercial).** `node scripts/imdb-datasets.js` downloads IMDb's daily `title.basics` and `title.ratings` TSVs and computes **votes per day** per tracked film — a faster word-of-mouth read than the rating itself, because it counts how many people cared enough to rate. It refuses to run unless `IMDB_DATASETS_ACK=non-commercial` is set: those datasets are licensed for personal and non-commercial use, and Screenstat is a commercial site. Licence via AWS Data Exchange for production.

**Google Trends.** No key needed for the *Trending now* feed. For interest-over-time, paste the Trends CSV into Pulse (works now), or set `SERPAPI_KEY` to enable the `trends` driver (paid), or add the official Trends API driver in `connectors/trends.js` once Google grants access.

**WordPress.** In the WP user's profile → *Application Passwords* → create one named `pulse-worker`. Put the username and password in `WP_USER` / `WP_APP_PASSWORD` and the site in `WP_URL`. Leave `WP_URL` blank until the plugin's `/sspulse/v1/films/{id}/ingest` route exists; the worker then writes payload files to `data/out/` instead.

## 3. Configure films

`config/films.json` — one entry per tracked film, keyed by the film's id in WordPress (use any stable string until the plugin exists):

```json
{
  "12": {
    "title": "Haiwaan",
    "aliases": ["haiwaan movie", "हैवान"],
    "cast": ["Akshay Kumar", "Saif Ali Khan"],
    "wiki_title": "Haiwaan_(film)",
    "wiki_title_hi": "",
    "yt_trailer_ids": ["<video id>"],
    "yt_teaser_ids": [],
    "yt_song_ids": [],
    "hashtags": ["haiwaan", "haiwaantrailer"],
    "hashtag_account": "<ig_user_id from assets.json>",
    "trends_benchmark": "Jawan",
    "release_date": "2026-09-11"
  }
}
```

`industries` decides which official Instagram accounts `meta-discovery` reads for this film — `Hindi`, `Telugu`, `Tamil`, `Kannada`, `Malayalam`, `Hollywood` or `Global`, one or several. `tmdb_id` and `imdb_id` are optional: leave them out and the connectors resolve by title and year, and record which way they matched in `meta`.

Rules that matter: the **first** trailer id is the official trailer (it drives `trTotal`, `likeRatio`, `tr24`); pin each film's hashtags to **one** Instagram account (30 unique hashtags per account per rolling week — the worker refuses a 31st and tells you); `trends_benchmark` is a recent hit of similar scale, because Trends values only mean something relative to one.

## 4. Run

```bash
node run.js --dry-run                      # every film, every enabled connector → data/out/film-<id>-<date>.json
node run.js --film 12 --connector youtube  # one film, one connector
node run.js                                # post to WordPress (or write files if WP_URL is blank)
```

Exit code 2 when any connector failed; each failure is printed with the film and connector so cron mail is readable. Every raw fetch is appended to `data/ingest-log.jsonl`; `data/state.json` holds the 90-day network maximum, frozen `tr24` values and hashtag-slot bookkeeping. Delete nothing in `data/` casually — the log is what makes `tr24` computable and lets you audit any Buzz jump.

Paste a `data/out/*.json` file into Pulse → *Data sources → Import* and the signals land with their provenance badges.

## 5. Schedule (systemd timers or cron, Asia/Kolkata)

```
*/30 * * * *  node run.js --connector trends-rss
0 */6 * * *   node run.js --connector youtube,meta-hashtags,meta-network,meta-discovery,reddit,trakt
30 8 * * *    node run.js --connector wikimedia,gsc,trends,spotify,tmdb
0 * * * *     node run.js --connector youtube --film <id>     # first 48 h after a trailer drops, then remove
```

Run the plugin's 09:00 IST daily reading **after** 08:30 ingestion, never before.

## 6. Sentiment — how the comments are read

The audience talks under the trailer. The worker reads it from two places and merges them:

- **YouTube** — top-level comments on the official trailer, every teaser (`yt_teaser_ids`) and the top two songs: 3 pages ordered by *relevance* (the most-liked comments, i.e. the crowd's verdict) plus 1 page by *time* (the freshest mood) per video, 100 comments a page, 1 quota unit a page. Videos with comments disabled are skipped silently.
- **Your pages** — comments on the film-tagged posts across the 100 Instagram accounts and Facebook Pages (cap 500 per film per run).

Each comment is scored by `lib/sentiment.js` (v2): a Hinglish + English lexicon with word boundaries (so "flop" is not "op"), **negation** that respects clause boundaries and Hindi word order ("mast nahi hai", "not bad", "flop nahi hoga"), a **spam filter** ("who's watching in 2026", "first", "1 like = …", links), and **like-weighting** — a comment counts `1 + log10(1 + likes)`, so one complaint with 9,000 upvotes outweighs thirty idle cheers. The signal is the like-weighted positive share of polar comments; the unweighted share is kept beside it. Aspect tagging produces **what they love / what worries them** (Lead star, Action, Music/BGM, Dialogues, Story, VFX/scale, Comedy, Nostalgia, Remake concern, Trailer cut, Runtime, Will watch in theatre / Will wait for OTT), which Pulse shows under *Audience voice*. Sources are merged by scored volume, and the per-source breakdown travels in `meta.sentiment.raw.by`.

Set `ANTHROPIC_API_KEY` and `SENTIMENT_MODEL` (a current small, fast model id) to switch the classifier to an LLM, which handles sarcasm and mixed comments far better; the lexicon remains the fallback on any error, and only comment text is sent — never usernames, ids or likes. The model version is stamped in `meta.sentiment.raw.model`; when you change classifiers, re-score history from `data/ingest-log.jsonl` rather than mixing versions in one chart.

A film needs at least 30 scored comments before `sentiment` is emitted; below that the field stays as the editor set it.

**Intent, not just mood.** `lib/intent.js` reads the same comments for *what the person says they will do* — definite ("FDFS pakka", "booking done", "theatre me dekhenge"), conditional ("reviews ke baad", "maybe"), no ("OTT pe dekhenge", "skip"; a negated definite counts as no). Only comments that state an intention count, one vote each. The run pools YouTube, your pages and Reddit into one `comments` sample per film (`payload.samples[]`) plus a per-source breakdown in `meta.intent`, and Pulse treats it like a follower poll with a 0.30 enthusiasm factor. For a tentpole that is thousands of stated intentions a day, refreshed every six hours, at zero cost.

## 7. Behaviour worth knowing

- `tr24` is only observable if the worker was polling around the trailer's first 24 hours; the value is interpolated from the two log rows bracketing `publishedAt + 24 h` and then frozen. Older trailers keep `tr24` for manual entry from trade reports.
- `net` is indexed to the network's own trailing-90-day maximum, so the first two weeks read hot while the baseline builds (`meta.net.raw.baseline_days` tells you how many days exist).
- Search Console data lags about two days; `meta.gsc.raw.data_through` states the last data date.
- A 429 or 5xx is retried with backoff; a 4xx is not. WordPress 422 (validation) is never retried — fix the connector.
- Comment texts are never sent to WordPress; only aggregates leave the worker.

## 8. Tests

`npm test` runs 29 offline tests with mocked HTTP: unit conversions, `tr24` interpolation, sentiment, film matching, and one recorded-shape response per connector. Add a fixture whenever an API changes shape.
