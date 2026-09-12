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

php tests/run-tests.php        (validation rules, public field whitelist, model-equality)
node tests/model-equality.mjs  (pins app/pulse-model.js against the HANDOVER-WORLD.md §5 fixtures -
                                 there is no PHP compute() to test against, see "Architecture" above)

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

== Uninstall ==

Tables are kept. Define SSPULSE_DROP_ON_UNINSTALL as true in wp-config.php to drop them on uninstall.
