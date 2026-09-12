# Pulse training corpus

The data every constant in Screenstat Pulse traces back to. Nothing here is read at runtime: the
model (`plugins/screenstat-pulse/app/pulse-model.js`) carries its own derived copies of these
tables, and this directory is the provenance behind them plus the input for any future re-fit.

It is deliberately **not** inside the plugin, so it is never copied into a container or served by
the web server. Two files are the exception and live in the plugin instead, because
HANDOVER-WORLD.md §2 says so and because the admin's Comparable-releases panel is meant to read
them:

| File | Lives at |
|---|---|
| `films_2016_2025.csv` (270 Hindi releases, the v1.4 fit input) | `plugins/screenstat-pulse/data/training.csv` |
| `world_films.csv` (1,124 rows, every industry) | `plugins/screenstat-pulse/data/world_films.csv` |

## What is here

| File | What it is |
|---|---|
| `sources_registry.csv` / `.json` | 256 resources Pulse can read, with access route, legal posture and reachability. Embedded in the model as `REG`. |
| `registry_summary.json` | The registry's counts. Embedded as `REGSUM`; byte-identical to it. |
| `industry_constants.json` | The fitted per-industry constants with a provenance string on each. Embedded as `INDUSTRY`, mirrored into the `sspulse_industry` table. |
| `fit_results.json` | The v1.4 regression coefficients, embedded as `FIT`. |
| `INDUSTRIES.md` | The multi-industry analysis. **Read §5 (Limits) before quoting any figure from this corpus.** |
| `ANALYSIS.md` | The v1.4 Hindi analysis behind the hold multipliers and verdict bands. |
| `instagram_handles.json`, `youtube_channels.json` | Registry-derived account lists. Archival: the live copies the worker reads are in `pulse-worker/config/sources.example.json`. |
| `raw/` | Per-source-page agent output, kept so any figure can be traced back to the Wikipedia table it came from. Nothing reads it. |

## Verified against the shipped model

Every table the model embeds was checked against the file it came from, by recomputation:

- `REG` is a faithful 14-field projection of the registry's 24 columns — identical ids, identical
  order, 3,579 of 3,584 compared fields byte-equal. Industries are abbreviated in `REG`
  (`HI TE TA KN ML HW GL`) where the CSV spells them out.
- `TRAIN` (270), `WORLD` (telugu 100, tamil 87, kannada 60, malayalam 38) and `GLOBAL` (100)
  reproduce their source rows with no value errors beyond 1-decimal rounding.
- The six industries' constants match across `industry_constants.json`, the model's `INDUSTRY`
  export and the `sspulse_industry` seed in `includes/class-seed.php`, provenance flags included.
- The acceptance fixtures in HANDOVER-WORLD.md §5 reproduce exactly, fixture E included — see
  `plugins/screenstat-pulse/tests/model-equality.mjs`.

## Known issues in the corpus

Recorded rather than fixed, because the model embeds these tables verbatim and editing a CSV here
would silently desync it from `pulse-model.js`. Fix them together, at the next re-fit.

- **`REG` truncates the `data` column to 150 characters**, losing text on 5 of 256 rows
  (`ormax-media` −87 chars, `meta-ig-discovery` −41, `tmdb` −17, `kobis` −8, `bookmyshow` −5, which
  cuts "calendar" mid-word). The registry CSV here holds the full text.
- **The Kannada comparables pool counts KGF: Chapter 2 twice**, once as `K.G.F: Chapter 2` and once
  as `KGF: Chapter 2`, so it carries double weight in a 60-row pool.
- **`INDUSTRIES.md` §1's sample sizes do not match this corpus** (it prints n = 233 / 60 / 37; the
  rows give 254 / 51 / 16). The three medians it quotes — 0.68, 0.56, 0.26 — do reproduce, and
  `industry_constants.json` agrees with them, so this is a stale n column, not a wrong constant.
- **`INDUSTRY.scale` reproduces only with the recipe stated in HANDOVER-WORLD.md §1** — median of
  each year's top three by worldwide gross, 2016–2025, *excluding dubbed titles from the Hindi
  side*. Drop that exclusion and Telugu comes out 40% low. The finished values are not recorded in
  `industry_constants.json`; only their inputs are, under `scale_ww_cr`.
- **The `sspulse_industry` table does not drive the model.** HANDOVER-WORLD.md §1 says the model
  "reads the table through REST and falls back to its embedded copy", but `pulse-model.js` resolves
  industries through a module-scope `const` with no setter, so editing the table changes nothing.
  The table is a seeded mirror only. Its `mult` column is missing for the same reason it would not
  matter yet — the model reads `ind.mult` for the four South pools, but only from its own copy.

## Re-fitting

Offline, deliberately. `pulse-model.js` is copied verbatim from the handover and is not edited by
hand; a re-fit regenerates it. When that happens, regenerate `plugins/screenstat-pulse/data/`'s two
CSVs, `industry_constants.json` and `fit_results.json` in the same pass, and re-run
`php plugins/screenstat-pulse/tests/run-tests.php` — the fixture tests there will catch a table that
moved without its constants.
