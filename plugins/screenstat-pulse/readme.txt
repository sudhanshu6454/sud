=== Screenstat Pulse ===
Contributors: screenstat
Requires at least: 6.4
Tested up to: 6.6
Requires PHP: 8.0
Stable tag: 1.7.0
License: GPLv2 or later

Pre-release intelligence for Indian films across six industries: Buzz Index, ticket intent and
projected collection with P10/P90 bands.

== What it does ==

* Private admin app (Pulse in the wp-admin menu) for the Screenstat desk: films, signals, audience
  poll samples, daily readings, actuals and model accuracy, across six industries (hindi, telugu,
  tamil, kannada, malayalam, hollywood). Storage is WordPress REST + eleven custom tables.
* The model (app/pulse-model.js, unchanged from the handover) runs in the browser for the live
  editing view, and in Node inside pulse-worker/ for the daily reading and for ingestion - see
  "Architecture: who computes what" below. There is no PHP port; v1.7's stochastic Monte Carlo
  core, industry table, event-calendar leg and post-release inference are exactly the kind of
  model a hand port silently drifts from, which the handover itself warns against.
* pulse-worker/ (a separate Node project, not loaded by WordPress) fills a film's signals from
  YouTube, Wikimedia, Meta Graph, Google Trends, Search Console, Spotify, Reddit, TMDB, Trakt and
  KOBIS, and computes the daily reading - see pulse-worker/README.md for connector setup.
* Public figures: [pulse film="slug" show="collection|buzz|intent"] and the "Pulse Figure" block.
  Every figure carries its source line, basis and est. suffix.

== Architecture: who computes what ==

WordPress never calls Meta, YouTube or any other external API from PHP cron - secrets for those
live only in pulse-worker/'s .env. The plugin:

* stores films, signals, samples, readings, actuals, the release calendar and the industry table;
* validates every write (class-validate.php) against the same ranges and enums pulse-model.js uses;
* accepts worker output at POST /films/{id}/ingest (signals + provenance) and
  POST /films/{id}/readings (a computed reading, source: 'cron');
* runs a daily watchdog (class-cron.php, 10:00 IST) that posts an admin notice - not a reading -
  when a tracked, filled film has no reading for today, meaning pulse-worker did not run.

pulse-worker/ owns computing: scripts/daily-reading.js fetches GET /films, runs the real
compute() from lib/pulse-model.js (byte-identical to app/pulse-model.js), and posts each result to
POST /films/{id}/readings. Its own scheduler (scripts/scheduler.js) also runs the ingestion
connectors on the schedule in pulse-worker/README.md §5. Deploy it as its own container
(docker compose up -d pulse_worker from the repo root) - see pulse-worker/README.md for every
connector's credentials and what happens with none configured (nothing to ingest, but the daily
reading still runs against whatever signals are already in WordPress).

== Data ==

data/calendar.json    Seeds the release calendar on activation (idempotent, re-imported when the
                      file's mtime changes).
data/examples.json    The three fictional example films behind "Load example films". Their signals
                      are the handover's reference EXAMPLES verbatim, and tests/model-equality.mjs
                      reads this file for acceptance fixtures A-E - so if it goes stale, the test
                      suite fails rather than the button.
data/training.csv     270 Hindi releases 2016-2025, the v1.4 fit input. Embedded in the model as
                      TRAIN; shipped here because the Comparable releases panel is specified to
                      read it.
data/world_films.csv  1,124 rows covering every industry plus Korea and Japan as reference markets.
                      Embedded in the model as WORLD/GLOBAL/WREF (HANDOVER-WORLD.md section 2 names
                      this path).

Both CSVs are public Wikipedia-derived aggregates and the same figures already ship inside
app/pulse-model.js, so nothing here is protected that is not already readable. The rest of the
corpus - the 256-row source registry, the fitted constants, the analyses and the raw traceability
output - deliberately lives at pulse-training/ in the repo root instead, where it is version
controlled but never deployed. See pulse-training/README.md, which also records the known issues in
the data (a truncated registry column, a duplicated Kannada comparable, a stale sample-size column
in INDUSTRIES.md).

== Capabilities ==

edit_pulse   Editor, Administrator  - films, signals, samples, readings, actuals, ingest, clip
manage_pulse Administrator          - archive films, edit the release calendar and industry table

== REST (sspulse/v1) ==

See HANDOVER.md §6 and HANDOVER-INGESTION.md §2 for the full contract. Public: GET
/public/films/{slug} (unfilled films 404; archived films only with a frozen projection, returned
beside the actuals). Everything else requires edit_pulse (or manage_pulse for calendar/archive) via
an Application Password - pulse-worker authenticates the same way autopub does for the other sites
in this repo.

== Tests ==

php tests/run-tests.php        (validation rules, public field whitelist, then model-equality)
node tests/model-equality.mjs  (all eight HANDOVER-WORLD.md §5 acceptance fixtures A-H against
                                 app/pulse-model.js - there is no PHP compute() to test against,
                                 see "Architecture" above - plus two integrity checks: that the
                                 plugin and pulse-worker copies of pulse-model.js are byte-identical,
                                 and that class-seed.php's industry notes match the model's strings
                                 exactly, which an ASCII-flattening edit would otherwise break
                                 silently)

Both run in CI (.github/workflows/ci.yml), alongside the worker's own suite.

pulse-worker/ has its own suite: cd pulse-worker && npm test.

== Deferred (not in this build) ==

The v1.7 handover's admin UI additions are not built: the source-registry panel, the audience-voice
/ sentiment panel, story-poll import, the IMDb/BookMyShow clipper bookmarklet generator, the Google
Trends chart, and the public vote-widget shortcode. The data layer for all of these (tables, REST
routes, validation) is in place and reachable over REST; app/pulse-app.js's signal desk (schema-
driven from pulse-model.js's GROUPS/RELEASE/CAL, plus a hand-added block for the new enum fields:
industry, genre, cert, event, franchise, remake, dubbed) reads and writes every v1.7 signal, but a
film's ingest provenance (meta), trending flag and post-release actual_days are stored and returned
by the REST API without a panel in this admin app yet.

Two further gaps are known and deliberately left, rather than half-built:

* The sspulse_industry table is a seeded mirror, not a control surface. HANDOVER-WORLD.md section 1
  describes the model reading the table over REST and falling back to its embedded copy, but
  pulse-model.js resolves industries through a module-scope constant with no setter, so editing a
  row changes nothing the model computes. The table is also missing the `mult` column the model
  reads for the four South comparables pools. Adding that column only becomes meaningful alongside
  the injection point, so both wait for the same piece of work.
* pulse-worker/config/sources.example.json says it was generated from the source registry, and it
  genuinely was - but no generator ships, so the config cannot track the registry. Writing one is
  not quite mechanical: scripts/discovery-check.js writes verification state (followers, enabled,
  errors) back into config/sources.json, so a generator has to merge rather than overwrite, and it
  needs a decision on how the registry's Global-tagged accounts map onto per-film industry
  selection. See pulse-training/README.md.

== Uninstall ==

Tables are kept. Define SSPULSE_DROP_ON_UNINSTALL as true in wp-config.php to drop them on uninstall.
