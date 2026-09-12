# Screenstat Pulse — the world's film industries as training data

**What this adds.** `ANALYSIS.md` calibrated Pulse on 270 Hindi releases. This file extends the training set sideways, to every industry a Screenstat reader cares about: Telugu, Tamil, Kannada and Malayalam; Hollywood in India; the global top ten of each year; and — as reference markets with unusually clean public data — South Korea and Japan. Everything lives in one table, `world_films.csv`, 1,124 rows, with a `basis` column on every row because the single most dangerous thing you can do with box-office data is add two numbers that mean different things.

| Industry | Rows | Years | Basis of the headline figure |
|---|---|---|---|
| Hindi | 270 | 2016–2025 | India nett ₹cr (plus worldwide gross, budget, Day 1, verdict) |
| Telugu | 100 | 2016–2025 | Worldwide gross ₹cr |
| Tamil | 87 | 2016–2025 | Worldwide gross ₹cr |
| Kannada | 60 | 2018–2025 | Worldwide gross ₹cr |
| Malayalam | 38 | 2016–2025 (dense 2023–25) | Worldwide gross ₹cr |
| India — all languages | 50 | all-time | Worldwide gross ₹cr |
| Hollywood in India | 3 | 2019–2026 | India gross ₹cr |
| Global top 10 per year | 100 | 2016–2025 | Worldwide gross US$M (+ budget, RT, franchise) |
| South Korea | 261 | 1999–2026 | Admissions (m) and/or US$M |
| Japan | 155 | 1982–2026 | Distributor gross ¥bn |

**Where it came from.** Wikipedia's per-language highest-grossing lists, per-year box-office tables and film infoboxes, read page by page and recorded with the source URL and the verbatim cell (`as_printed`) on every row. Where Wikipedia prints a range — and it very often does — the low end is stored and the range is kept in `notes`. Nothing was inferred to fill a blank.

## 1. The conversion that makes cross-industry comparison possible

Pulse thinks in India nett. The South lists publish worldwide gross. Bridging them is the whole job, and the Hindi set does it because it carries both numbers for all 270 films.

| Ratio | Median | n |
|---|---|---|
| India nett ÷ worldwide gross, Hindi originals | **0.68** | 233 |
| Same, films grossing over ₹300 cr worldwide | **0.56** | 60 |
| Same, Hindi versions of dubbed South films | 0.26 | 37 |

Bigger films earn a larger share overseas, so the share falls as scale rises — which is why a single constant would mis-state exactly the films Pulse is most often pointed at. For South films the same ratio can only be fitted on the 23 rows where Wikipedia prints both an India and a worldwide figure: Telugu 0.79 India gross ÷ worldwide (implied nett share 0.65), Tamil 0.65 (0.53), Malayalam 0.61 (0.50). Twenty-three films is a prior, not a constant, and Pulse treats it as one — the industry conversion is an editable field, seeded from these numbers, and the accuracy loop re-fits it the moment Screenstat has its own actuals.

## 2. Scale — what "big" means in each industry

Worldwide gross of each year's biggest film, ₹ crore:

| Year | Hindi | Telugu | Tamil | Kannada | Malayalam |
|---|---|---|---|---|---|
| 2016 | 2,024 | 150 | 320 | — | 139 |
| 2017 | 1,810 | 1,811 | 230 | — | — |
| 2018 | 800 | 216 | 710 | 250 | 67 |
| 2019 | 475 | 406 | 300 | 90 | 126 |
| 2020 | 368 | 262 | 250 | 6 | 48 |
| 2021 | 373 | 360 | 300 | 78 | 81 |
| 2022 | 1,215 | 1,300 | 500 | 1,200 | 85 |
| 2023 | 1,148 | 614 | 605 | 67 | 177 |
| 2024 | 1,871 | 1,642 | 440 | 62 | 242 |
| 2025 | 850 | 294 | 514 | 850 | 302 |

Two things the model needed and now has. First, the ceiling is industry-specific but no longer Hindi's alone: Telugu matched or beat Hindi's topper in 2017, 2022 and 2024, and Kannada did it twice from a base that is otherwise an order of magnitude smaller. A Buzz score that maps to ₹60 cr on Day 1 for a Hindi tentpole cannot map to the same number for a mid-budget Malayalam release, and Pulse now scales the demand leg by industry rather than pretending one market exists. Second, the *variance* is the story in Kannada and Malayalam: Kannada's median notable film is ₹30 cr and its topper twice went past ₹850 cr, which is a distribution Pulse must express as a wide band, not a point estimate.

Return on budget, where both figures exist:

| Industry | n | p25 | median worldwide ÷ budget | p75 |
|---|---|---|---|---|
| Hindi | 257 | 0.86 | 1.57 | 3.48 |
| Telugu | 40 | 1.52 | 2.20 | 3.32 |
| Tamil | 35 | 1.19 | 1.67 | 2.38 |
| Kannada | 18 | 1.45 | 1.73 | 4.59 |
| Malayalam | 12 | 1.83 | **4.69** | 9.68 |
| Global top 10 | 94 | — | 5.46 | — |

Malayalam's multiple is the highest in India by a distance and its sample the smallest — twelve films, all of them ones Wikipedia thought worth listing. Read it as a direction, not a number: the industry that spends least per film converts reception into multiples the others cannot, which is the same effect the Hindi set showed for sub-₹60 cr films (hit rate 47% against 33% for films over ₹150 cr), only stronger.

## 3. Reference markets — what clean data looks like

South Korea publishes admissions, not just money, because every ticket passes through one government system. Across the 66 rows carrying both, a Korean admission is worth **US$7.42**, and a year-topper sells **11.9 million** tickets in a country of 52 million. Korea's yearly top ten splits 45 domestic to 42 foreign — an almost even market. Japan's top ten runs 60 domestic to 40 foreign and **32% anime**, with a year-topper at a median ¥15.8 bn.

Neither market is Screenstat's beat. Both earn their place for one reason: they are the only places where an intent signal like Pulse's can be checked against a published, audited denominator. KOBIS prints a *reservation rate* — the share of tomorrow's tickets already sold — which is the single closest public analogue to what Pulse estimates, and the `kobis` connector in the registry exists so that the model's advance-booking leg can be validated against a market that actually publishes the truth before re-applying it to India, where no one does.

Globally, the top ten of each year is 83% franchise and clears a median US$864 M on a median RT score of 77. The COVID trough is stark in a way worth keeping in the training set: the global top ten totalled US$13.2 bn in 2019, US$3.5 bn in 2020, and only returned past 2019 in 2025 (US$11.1 bn, still short).

## 4. What Pulse does with this

Four changes, each traceable to a number above.

The **industry selector** sets the basis (India nett for Hindi, worldwide gross for the South lists, India gross for Hollywood-in-India), the conversion to nett, the average ticket price and the seat pool, so the funnel, the supply leg and the verdict bands are all computed in one consistent unit and displayed with that unit named. The **comparables leg** now filters by industry, so a Malayalam thriller is matched to Malayalam films rather than to Hindi ones, and falls back to the Hindi regression — clearly labelled — when an industry has too few rows to support a fit, which today is the case for Kannada and Malayalam. The **verdict bands** stay ratio-based and therefore travel: a film at 1.4× budget is a Hit in any language. And the **band width** widens where the data says it should: industries whose observed distribution is fat-tailed get a larger residual σ in the Monte Carlo, so Pulse's P10–P90 for a Kannada release is honestly wider than for a Hindi one.

## 5. Limits — read these before quoting anything

Wikipedia's language lists are top-of-market: they record the films that were notable, so every median here is the median of a notable film, not of a release. Hit rates computed on this set will run above the industry's true rate, exactly as they do in `ANALYSIS.md`. The South figures are worldwide gross "based on conservative global box office estimates" with, in Wikipedia's own words, no official tracking — there is no audited Indian box office, and trackers disagree by 3–10%. Budgets are the weakest field everywhere, ranges are common, and marketing spend may or may not be inside them; nothing derived from a budget should be quoted tighter than ±30%. Kannada has no rows before 2018 and Malayalam only becomes dense from 2023, so their year-toppers before then are absences in the source, not zeroes. Korea's admissions stop being printed in Wikipedia's year tables after 2018 and 2019–2020 have no top-ten table at all, so those years hold weekly number-ones instead. Three 2026 releases sit in the Japanese and Indian all-time lists still in theatres; they are kept, flagged in `notes`, and excluded from any rate.

The right way to use this file is as a prior that the accuracy loop overwrites. Every constant it produces is stamped with its provenance in `industry_constants.json`, and every one of them should be re-fitted from Screenstat's own recorded actuals as those accumulate — which is the only box-office data anyone will ever have that was not first estimated by someone else.
