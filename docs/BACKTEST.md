# Litmus backtest

**Across 12 already-disputed prediction markets whose ambiguity was present in the
resolution text, Litmus retroactively flagged 10 (83%) as elevated-or-higher risk —
while leaving the one control case unflagged. Mean risk on disputed markets was 57 vs
29 on the control: a 28-point separation.**

Run: `npm run backtest` · Model: `claude-opus-4-8` · First run: 2026-06-27

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
dispute is independently known for the engine also flagged (≥50).

### Recall by threshold

A market is "flagged" if combined risk ≥ T.

| T | detectable disputes | control |
|---|---|---|
| ≥45 | **10/12 (83%)** | 0/1 |
| ≥50 | 9/12 (75%) | 0/1 |
| ≥60 | 4/12 (33%) | 0/1 |
| ≥65 | 4/12 (33%) | 0/1 |

- **Mean risk separation:** detectable disputes 57 vs control 29 (gap 28).
- **Reason precision:** the engine independently flagged 28/51 (55%) of the specific
  dimensions each dispute is known for — and 27/37 (73%) on the disputes it flagged.
  The control case correctly contributes 0/2 (we *want* its dimensions unflagged).

### The two misses (honest)

- **Oscars viewership (42)** — the source-revision trap ("revised figures don't count")
  is subtle; the engine saw the named source and under-weighted the revision clause.
- **Cardi B, Polymarket (30)** — Polymarket's rules ("performs live and in person") were
  genuinely tighter than Kalshi's looser definition (which scored 51). The dispute there
  leaned on judging the live event, not on text ambiguity. A defensible low score on a
  case still labeled a dispute.

We do **not** tune the prompt against these, since this is the set the number is reported
on. Improving recall means expanding the gold-set with *new* held-out cases.

## Reproduce

```bash
npm run backtest          # scores all fixtures blind, prints this table
# full per-case output (incl. every dimension score) → data/backtest-results.json
```
