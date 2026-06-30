# Litmus backtest

**Across 12 already-disputed prediction markets whose ambiguity was present in the
resolution text, Litmus retroactively flagged 10 as elevated-or-higher risk — a recall of
10/12 = 83% (95% CI 55–95%) — while leaving the one control case unflagged. Mean risk on
disputed markets was 57 vs 29 on the control: a 28-point separation.**

Run: `npm run backtest` · Model: `claude-opus-4-8` · First run: 2026-06-27

> Read the [Limits](#limits-read-this-before-quoting-the-number) section before quoting
> the 83%. It is a real result on a small, mostly-positive set — recall is meaningful;
> precision in the wild is not yet measured.

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
| 06 | Zelenskyy wears a suit before July | Polymarket | text | **73** | high | 4/4 |
| 09 | TikTok banned in US before May 2025 | Polymarket | text | **74** | high | 4/4 |
| 11 | Barron Trump involved with $DJT token | Polymarket | text | **73** | high | 4/4 |
| 13 | US invades Venezuela | Polymarket | text | **72** | high | 4/4 |
| 10 | OceanGate Titan found by June 23 | Polymarket | text | **58** | elevated | 3/4 |
| 07 | Ukraine agrees to Trump mineral deal | Polymarket | text | **54** | elevated | 2/4 |
| 01 | Khamenei out as Supreme Leader | Kalshi | text | **53** | elevated | 2/5 |
| 12 | Ethereum ETF approved by May 31 2024 | Polymarket | text | **53** | elevated | 3/4 |
| 02 | Cardi B performs at Super Bowl LX | Kalshi | text | **51** | elevated | 1/4 |
| 08 | MicroStrategy sells any BTC by May 31 | Polymarket | text | **47** | elevated | 1/4 |
| 04 | 2025 Oscars viewership over ~19.5M | Kalshi | text | 42 | moderate | 0/4 |
| 14 | Cardi B performs at Super Bowl LX | Polymarket | text | 30 | moderate | 0/4 |
| 03 | 49ers over 10.5 wins *(control)* | Kalshi | ctrl | 29 | moderate | 0/2 |

`detect = text` → ambiguity present in the rules (should flag). `ctrl` → surprise came
from outside the text (should not flag). `reason-hit` = how many of the dimensions this
dispute is independently known for the engine also flagged (a single dimension counts as
flagged at ≥50 — a deliberately stricter bar than the 45 market-level boundary).

### Recall by threshold

A market is "flagged" if combined risk ≥ T. Recall is over the 12 detectable disputes.

| T | detectable disputes | recall (95% CI) | control |
|---|---|---|---|
| **≥45** *(pre-registered)* | **10/12** | **83% (55–95%)** | 0/1 |
| ≥50 | 9/12 | 75% (47–91%) | 0/1 |
| ≥60 | 4/12 | 33% (14–61%) | 0/1 |
| ≥65 | 4/12 | 33% (14–61%) | 0/1 |

- **Mean risk separation:** detectable disputes 57 vs control 29 (gap 28). With n=1
  control this is a direction, not a tested effect — see Limits.
- **Reason precision:** the engine independently flagged 28/51 (55%) of the specific
  dimensions each dispute is known for — and 28/41 (68%) on the 10 markets it flagged
  (≥45). The control case correctly contributes 0/2 (we *want* its dimensions unflagged).

### The two misses (honest)

- **Oscars viewership (42)** — the source-revision trap ("revised figures don't count")
  is subtle; the engine saw the named source and under-weighted the revision clause.
- **Cardi B, Polymarket (30)** — Polymarket's rules ("performs live and in person") were
  genuinely tighter than Kalshi's looser definition (which scored 51). The dispute there
  leaned on judging the live event, not on text ambiguity. A defensible low score on a
  case still labeled a dispute.

We do **not** tune the prompt against these, since this is the set the number is reported
on. Improving recall means expanding the gold-set with *new* held-out cases.

## Limits (read this before quoting the number)

This is an honest small-sample result, not a finished evaluation. What it does and does
not support:

- **Small n, wide interval.** 10/12 has a 95% Wilson interval of 55–95%. The point
  estimate is 83%; the *evidence* is "probably good, not precisely pinned." Quote the
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

[`data/backtest-results.json`](../data/backtest-results.json) holds the recorded results
of the first run (combined score, band, and reason-hits per case) so the numbers above can
be checked without an API key. A fresh `npm run backtest` overwrites it with the full
per-dimension detail.
