# Litmus backtest

**Across 12 already-disputed prediction markets whose ambiguity was present in the
resolution text, Litmus retroactively flagged 9 as elevated-or-higher risk — a recall of
9/12 = 75% (95% CI 47–91%) — while scoring the one control case 20 (low band, well clear
of the flag line). Mean risk on disputed markets was 55 vs 20 on the control: a 35-point
separation.**

Run: `npm run backtest` · Model: `claude-opus-4-8` · Current run: 2026-07-03 (prompt v2)

> Read the [Limits](#limits-read-this-before-quoting-the-number) section before quoting
> the 75%. It is a real result on a small, mostly-positive set — recall is meaningful;
> precision in the wild is not yet measured.

**Prompt history (full disclosure):** the first run (2026-06-27, prompt v1) scored
10/12 = 83% (95% CI 55–95%) with the control at 29 (separation 28). Prompt v2 added a
*boilerplate-activation* rule — platform-standard clauses present in every market are
scored only when this market's subject makes them likely to bind — motivated by live
false alarms on the forward board, **not** by these fixtures. Re-run against the
gold-set, recall dropped one case (the Kalshi Cardi B market fell from 51 to 36) while
discrimination improved markedly (control 29 → 20; separation 28 → 35). We report the
current prompt's numbers as the headline because they describe the engine that actually
runs; both runs are recorded here.

## Why this is the real validation

Anyone can color a risk dot. The question is whether the score would have caught the
markets that *actually blew up on resolution* — before they did. So we score real,
already-resolved markets **blind**: the engine sees only the original pre-settlement
rules text, never the outcome or the news of what went wrong.

The gold-set is split by an honest control:

- **Text-detectable disputes** (the recall set) — the ambiguity was present in the
  rules a trader could read. The engine *should* flag these.
- **Control** — the market mis-settled for a reason *outside* the text (e.g. a grading
  error). The text was clean. The engine *should not* flag these. A tool that flags
  everything is useless; the control is what proves it discriminates.

## What "flagged" means (pre-registered)

A market is **flagged** when its combined risk is **≥ 45**. That is the "elevated" band
boundary defined in [`src/engine/weights.ts`](../src/engine/weights.ts) (`riskBand`) — a
cutoff set by the scoring scale itself, **not** chosen to maximize this number. The live
tracker ([`src/track/store.ts`](../src/track/store.ts) `isFlagged`) uses the same 45, so
the backtest and production agree on what "flagged" means. The full threshold sweep is
printed below so the choice is auditable rather than cherry-picked.

## The gold-set (13 cases)

Each case is a documented real dispute / controversial settlement. Resolution text was
pulled verbatim from the platform APIs (Polymarket Gamma `description`, Kalshi
`rules_primary`/`rules_secondary`) or web archives, then adversarially vetted so no
fixture leaks the outcome. One case (a tennis no-play) was dropped — its original
per-market rules could not be recovered, and we won't reconstruct rules from hindsight.

## Results

| case | market | platform | detect | risk | band | reason-hit |
|---|---|---|---|---|---|---|
| 06 | Zelenskyy wears a suit before July | Polymarket | text | **77** | high | 4/4 |
| 11 | Barron Trump involved with $DJT token | Polymarket | text | **74** | high | 4/4 |
| 09 | TikTok banned in US before May 2025 | Polymarket | text | **69** | high | 4/4 |
| 13 | US invades Venezuela | Polymarket | text | **67** | high | 4/4 |
| 07 | Ukraine agrees to Trump mineral deal | Polymarket | text | **59** | elevated | 2/4 |
| 01 | Khamenei out as Supreme Leader | Kalshi | text | **58** | elevated | 2/5 |
| 10 | OceanGate Titan found by June 23 | Polymarket | text | **55** | elevated | 3/4 |
| 08 | MicroStrategy sells any BTC by May 31 | Polymarket | text | **50** | elevated | 1/4 |
| 12 | Ethereum ETF approved by May 31 2024 | Polymarket | text | **50** | elevated | 3/4 |
| 02 | Cardi B performs at Super Bowl LX | Kalshi | text | 36 | moderate | 0/4 |
| 04 | 2025 Oscars viewership over ~19.5M | Kalshi | text | 35 | moderate | 0/4 |
| 14 | Cardi B performs at Super Bowl LX | Polymarket | text | 35 | moderate | 0/4 |
| 03 | 49ers over 10.5 wins *(control)* | Kalshi | ctrl | 20 | low | 0/2 |

`detect = text` → ambiguity present in the rules (should flag). `ctrl` → surprise came
from outside the text (should not flag). `reason-hit` = how many of the dimensions this
dispute is independently known for the engine also flagged (a single dimension counts as
flagged at ≥50 — a deliberately stricter bar than the 45 market-level boundary).

### Recall by threshold

A market is "flagged" if combined risk ≥ T. Recall is over the 12 detectable disputes.

| T | detectable disputes | recall (95% CI) | control |
|---|---|---|---|
| **≥45** *(pre-registered)* | **9/12** | **75% (47–91%)** | 0/1 |
| ≥50 | 9/12 | 75% (47–91%) | 0/1 |
| ≥60 | 4/12 | 33% (14–61%) | 0/1 |
| ≥65 | 4/12 | 33% (14–61%) | 0/1 |

- **Mean risk separation:** detectable disputes 55 vs control 20 (gap 35, up from 28
  under prompt v1). With n=1 control this is a direction, not a tested effect — see Limits.
- **Reason precision:** the engine independently flagged 27/51 (53%) of the specific
  dimensions each dispute is known for — and 27/37 (73%) on the 9 markets it flagged
  (≥45). The control case correctly contributes 0/2 (we *want* its dimensions unflagged).

### The three misses (honest)

- **Cardi B, Kalshi (36; was 51 under prompt v1)** — the boilerplate-activation rule cost
  this case: the engine now discounts Kalshi's standard performs/appears definitional
  language unless the market's subject activates it, and here that language was exactly
  what bit. The trade-off bought a much cleaner control (29 → 20) and fewer live false
  alarms; this is the case that paid for it.
- **Oscars viewership (35)** — the source-revision trap ("revised figures don't count")
  is subtle; the engine saw the named source and under-weighted the revision clause.
- **Cardi B, Polymarket (35)** — Polymarket's rules ("performs live and in person") were
  genuinely tighter; the dispute leaned on judging the live event, not text ambiguity.
  A defensible low score on a case still labeled a dispute.

We do **not** tune the prompt against these, since this is the set the number is reported
on. Improving recall means expanding the gold-set with *new* held-out cases.

## Limits (read this before quoting the number)

This is an honest small-sample result, not a finished evaluation. What it does and does
not support:

- **Small n, wide interval.** 9/12 has a 95% Wilson interval of 47–91%. The point
  estimate is 75%; the *evidence* is "probably good, not precisely pinned." Quote the
  interval, not just the headline.
- **Recall, not precision.** The set is 12 positives and **one** negative. We can measure
  how many real disputes we catch (recall); we **cannot** yet measure how often we flag a
  market that resolves cleanly (precision / false-positive rate) — that needs a
  representative sample of clean markets, which is the next validation step. On the live
  board ~40% of markets score ≥45, so if true disputes are rare, real-world precision
  could be much lower than recall. Do not claim precision from this set.
- **The control is a single case.** "0/1 on the control" has a 95% CI of 0–79% — it is
  consistent with discrimination but proves little on its own. One clean case is a sanity
  check, not a specificity measurement.
- **World-knowledge leakage is possible.** The `literal_vs_intuitive` dimension is allowed
  to use world knowledge to judge what a casual reader assumes. For famous resolved
  disputes (TikTok, Zelenskyy, Ethereum ETF) the model may have seen the actual
  controversy in training and pattern-matched the known blow-up rather than detecting
  ambiguity cold. The fixture *text* is vetted not to leak the outcome, but the model's
  own memory can. Out-of-time cases (markets resolving after the training cutoff) would
  neutralize this — also on the to-do list.
- **Single run.** These are one run's scores. Score variance across repeated runs (and how
  often the band flips) is not yet quantified.

## Reproduce

```bash
npm run backtest          # scores all fixtures blind, prints this table
# full per-case output (incl. every dimension score) → data/backtest-results.json
```

[`data/backtest-results.json`](../data/backtest-results.json) is the committed artifact
of the current run — per-case combined score, band, and every dimension score — so the
numbers above can be checked without an API key. A fresh `npm run backtest` overwrites it.
