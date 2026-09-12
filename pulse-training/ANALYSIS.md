# Screenstat Pulse — calibration on 2016–2025 Hindi releases

**Dataset:** `films_2016_2025.csv` — 270 Hindi theatrical releases, 2016 to December 2025, with budget, opening day, opening weekend, week 1 and lifetime India nett (₹ crore), worldwide gross, trade verdict, and attributes (star tier 1–5, franchise, holiday opening, genre, remake, dubbed South film, IMDb rating, COVID-era flag). Figures are trade-reported (Sacnilk / Bollywood Hungama / Box Office India conventions) and **approximate**; sixteen dubbed South films are included with their Hindi-version figures; thirteen COVID-era releases (March 2020 – December 2021) are flagged and excluded from rate calculations.

**How reliable is it?** A random 42-film sample was checked against Wikipedia's box-office sections by four independent passes. Opening-day figures matched within 3% in 25 of the 27 cases where Wikipedia states one; lifetime nett was consistent with Wikipedia's India gross at the standard 1.18–1.28 gross-to-nett ratio in every case where both existed; two figures were corrected (Jawan's Day 1 to the all-language basis, Chhaava to all-language). Budgets are the least reliable field — Wikipedia itself gives ranges (Stree 2: ₹50–105 cr; Samrat Prithviraj: ₹150–300 cr) and trade figures differ on whether marketing is included — so treat any ratio-to-budget as ±30%. The set over-represents notable films (big openers and famous flops) relative to the ~200 Hindi releases a year, so **absolute hit rates here run above the industry's**; the *relative* effects are what the model uses.

**Verdict definition used throughout:** Hit+ = Hit, Super Hit or Blockbuster (trade verdict). Flop = Flop or Disaster.

## 1. What the trade verdicts mean in numbers

Lifetime India nett ÷ budget, non-COVID films (n = 257):

| Verdict | n | p25 | median | p75 |
|---|---|---|---|---|
| Disaster | 49 | 0.18 | 0.26 | 0.38 |
| Flop | 54 | 0.54 | 0.72 | 0.86 |
| Average | 49 | 0.70 | 0.95 | 1.26 |
| Hit | 54 | 1.50 | 1.98 | 2.36 |
| Super Hit | 20 | 2.89 | 3.64 | 4.53 |
| Blockbuster | 31 | 2.07 | 3.53 | 5.54 |

Pulse's verdict bands are now set from these: Disaster risk < 0.45× · Flop risk 0.45–0.85× · Average 0.85–1.4× · Hit 1.4–2.5× · Super hit 2.5–3.5× · Blockbuster ≥ 3.5×. (Previous bands, set by judgement, called anything above 2× a Blockbuster — too generous.) Super Hit and Blockbuster overlap heavily because the trade reserves "Blockbuster" for scale as well as ratio.

## 2. How films hold — the multipliers Pulse now uses

Grouped by IMDb rating as the proxy for word of mouth (non-COVID):

| IMDb | n | weekend ÷ Day 1 (3-day openers) | week 1 ÷ weekend | lifetime ÷ week 1 | lifetime ÷ Day 1 | Day 1 share of lifetime |
|---|---|---|---|---|---|---|
| < 5 | 55 | 3.24 | 1.47 | 1.18 | 5.8 | 17% |
| 5 – 6.5 | 83 | 3.49 | 1.49 | 1.30 | 7.0 | 14% |
| 6.5 – 7.5 | 72 | 4.07 | 1.60 | 1.53 | 10.1 | 10% |
| > 7.5 | 47 | 4.30 | 1.78 | 1.94 | 14.9 | 7% |

By verdict, lifetime ÷ week 1: Disaster 1.10 · Flop 1.22 · Average 1.38 · Hit 1.56 · Super Hit 1.81 · Blockbuster 1.99. Day 1 share of lifetime: Disaster 20% · Flop 15% · Average 13% · Hit 10% · Blockbuster 8%.

Model changes (word-of-mouth factor `w` 0–1 derived from like ratio and comment sentiment): Saturday = Day 1 × (1.02 + 0.50w) (holiday openers 0.90 + 0.35w); Sunday = Saturday × (1.08 + 0.16w); weekday decay unchanged; **lifetime = week 1 × (1.08 + 1.10w)**, replacing 1.45 + 1.15w. The old constants overstated the floor: a badly received film holds only ~1.2× its first week, not 1.45×.

## 3. What opened films — Day 1 drivers

OLS on log(Day 1), non-COVID, R² = 0.55, residual σ = 0.70 (a factor of two either way):

| Factor | Effect on Day 1 |
|---|---|
| Franchise / sequel | ×1.63 |
| Each star tier (1–5) | ×1.48 |
| Holiday / extended-weekend opening | ×1.34 |
| Epic / period / mythological genre | ×1.31 |
| Budget (elasticity) | 0.31 — doubling the budget lifts Day 1 only ×1.24 |
| Romance | ×1.15 |
| Dubbed South film | ×1.09 |
| Comedy | ×0.92 |
| Thriller | ×0.90 |
| Remake | ×0.82 |
| Drama / biopic / sports | ×0.81 |

This regression is Pulse's new **fourth Day 1 estimate** ("Comparables"). Its σ of 0.70 in log space means it is deliberately the lightest leg in the inverse-variance blend (about 4–8% weight when the other legs are present), but it anchors films with no signals yet and surfaces the six closest historical releases in the *Comparable releases* panel.

## 4. What decided the verdict

Lifetime = Day 1^0.92 × 1.29^IMDb × …, R² = 0.86. **At the same opening, each extra IMDb point multiplied lifetime by ×1.29.** Opening explains scale; reception explains the multiple.

Hit+ rate by factor (non-COVID, n = 257, base rate 41%):

| Factor | n | Hit+ | Flop/Disaster | median lifetime ÷ budget |
|---|---|---|---|---|
| IMDb ≥ 7.5 | 54 | **76%** | 7% | 2.16 |
| IMDb 6.5–7.5 | 75 | 49% | 28% | 1.18 |
| IMDb 5–6.5 | 78 | 27% | 53% | 0.82 |
| IMDb < 5 | 50 | **12%** | 74% | 0.57 |
| Franchise / sequel | 54 | 52% | 24% | 1.09 |
| Original | 203 | 38% | 44% | 0.96 |
| Remake | 31 | 32% | **61%** | 0.73 |
| Budget ≥ ₹150 cr | 43 | 33% | 44% | 0.62 |
| Budget ₹60–150 cr | 89 | 36% | 51% | 0.96 |
| Budget < ₹60 cr | 125 | 47% | 31% | 1.37 |
| Star tier 5 | 20 | 40% | 50% | 1.11 |
| Star tier 4 | 75 | 48% | 37% | 0.99 |
| Star tier 3 | 75 | 49% | 35% | 1.14 |
| Star tier 2 | 71 | 23% | 49% | 0.87 |
| Holiday opening | 91 | 44% | 42% | 1.00 |
| Non-holiday | 166 | 39% | 39% | 1.00 |
| Horror-comedy | 8 | 62% | 12% | 2.26 |
| Biopic | 12 | 58% | 17% | 1.24 |
| Comedy | 48 | 50% | 31% | 1.06 |
| Drama | 38 | 47% | 32% | 1.54 |
| Action | 55 | **22%** | 56% | 0.71 |
| Romance | 35 | 37% | 49% | 0.93 |
| Big star (tier ≥ 4) and budget ≥ ₹150 cr | 35 | 34% | 46% | 0.71 |
| Small star (tier ≤ 2) and IMDb ≥ 7.5 | 21 | 67% | 5% | 2.10 |
| Day 1 ≥ ₹25 cr | 30 | 67% | 17% | 2.07 |
| Day 1 < ₹5 cr | 84 | 23% | 60% | 0.54 |

Logistic regression on **pre-release** factors only (accuracy 72% vs 41% base): budget is the strongest negative (odds ×0.25 per e-fold of budget), franchise ×2.27, each star tier ×2.21, holiday ×1.35, remake ×0.66, epic genre ×2.9, comedy ×1.6. Adding reception (IMDb) lifts accuracy to 79% and IMDb becomes the largest single term (odds ×3.45 per point). Pulse shows the pre-release model as the **base rate for films like this** on the collection tile.

## 5. The Friday tell

Day 1 as a share of budget, and what followed:

| Day 1 ÷ budget | n | Hit+ | median lifetime ÷ budget |
|---|---|---|---|
| < 5% | 39 | 13% | 0.22 |
| 5–10% | 60 | 7% | 0.53 |
| 10–20% | 85 | 42% | 1.07 |
| 20–35% | 53 | 75% | 2.13 |
| > 35% | 20 | 100% | 4.59 |

Once the real Day 1 is entered in *Model accuracy*, Pulse states which bracket the film landed in and the historical hit rate for it.

## 6. Key factors for hit and flop — in one paragraph

Openings are bought with franchise, star and a holiday; verdicts are earned with reception. Big budgets did not buy verdicts — they raised the bar and lowered the hit rate. Remakes underperformed both on Day 1 and in the verdict. Action, the most expensive genre, had the worst hit rate; horror-comedy, biopics and well-received dramas the best. A weak Day 1 relative to budget (under 10%) was close to fatal; a strong one (over 20%) almost always ended well, because word of mouth then had scale to work on. The flop signature is front-loading: a fifth of lifetime on Day 1.

## 7. Limits

Selection bias (notable releases over-represented); trade figures differ by tracker by 3–10%; budgets ±30%; IMDb is a post-release proxy for reception, so pre-release Pulse relies on comment sentiment and like ratio as the live stand-in; dubbed South films behave differently (long legs, low Day 1 share) and are matched only to other dubbed films in the comparables leg; 2026 releases are excluded pending final figures. Every constant here should be re-fitted as Screenstat's own actuals accumulate through the accuracy loop.
