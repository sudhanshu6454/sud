=== Screenstat Pulse ===
Contributors: screenstat
Requires at least: 6.4
Tested up to: 6.6
Requires PHP: 8.0
Stable tag: 1.0.0
License: GPLv2 or later

Pre-release intelligence for Hindi films: Buzz Index, ticket intent and projected collection with P10/P90 bands.

== What it does ==

* Private admin app (Pulse in the wp-admin menu) for the Screenstat desk: films, signals, audience poll
  samples, daily readings, actuals and model accuracy. The model runs in the browser (app/pulse-model.js,
  unchanged from the handover); storage is WordPress REST + four custom tables.
* Daily cron at 09:00 IST records a reading for every tracked, filled film (PHP port of the model,
  proven equal to the JS module by tests/model-equality.php).
* Public figures: [pulse film="slug" show="collection|buzz|intent"] and the "Pulse Figure" block.
  Every figure carries its source line, basis and est. suffix.

== Capabilities ==

edit_pulse   Editor, Administrator  - films, signals, samples, readings, actuals
manage_pulse Administrator          - archive films, edit the release calendar

== REST (sspulse/v1) ==

See HANDOVER.md §6. Public: GET /public/films/{slug} (unfilled films 404; archived films only with a
frozen projection, returned beside the actuals).

== Tests ==

php tests/run-tests.php   (validation rules, public field whitelist, PHP-vs-JS model equality)
node tests/fixtures.mjs   (regenerate fixtures from the JS reference)

== Uninstall ==

Tables are kept. Define SSPULSE_DROP_ON_UNINSTALL as true in wp-config.php to drop them on uninstall.
