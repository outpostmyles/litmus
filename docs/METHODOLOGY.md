# Litmus — methodology in one page

Litmus scores the risk that a prediction market **settles differently than its traders
expect**, by reading the resolution criteria the way an escalations analyst would: literally,
adversarially, and before the money moves. It prices the *rules*, not the event.

## The taxonomy: five ways resolution goes sideways

Every dimension maps to a documented, recurring class of real dispute. Each case below is a
committed fixture in [`data/fixtures/backtest/`](../data/fixtures/backtest) — verbatim
pre-settlement rules text, plus a separate answer-key field the engine is never passed:

| Dimension | Failure class it catches | Real case |
|---|---|---|
| **Source clarity** | No named source of truth, or a named source whose figures get revised | Oscars viewership: Nielsen's *revised* figures didn't count |
| **Criteria precision** | Undefined thresholds, rounding, timezones, "a rate cut" of unstated size | Ethereum ETF: "approved" — approval of *what*, by *when*? |
| **Literal-vs-intuitive gap** | The headline question and the operative clause diverge | Khamenei "out": a death carveout settled at pre-strike price, not YES |
| **Timing** | The event can happen but the *clock* can miss — delays, extensions, cutoff instants | TikTok ban: enacted vs enforced vs stayed, before which date? |
| **Dispute surface** | Resolution needs subjective judgment; committees hold discretion | Zelenskyy "wears a suit": who decides what counts as a suit? |

Each dimension returns a 0–100 score, a reasoning sentence, and the **verbatim offending
clause** — the load-bearing span of rules text, quoted back. Auditable claims, not vibes.

## The combine: deterministic, in code

The model scores dimensions; **code** combines them
([`src/engine/weights.ts`](../src/engine/weights.ts)):

```
combined = 0.7 × weighted-average + 0.3 × worst-dimension
```

The worst-dimension blend exists because one fatal clause blows up a market even when the
other four dimensions are clean — a pure average would bury the Khamenei carveout. Bands:
&lt;25 low · &lt;45 moderate · &lt;65 elevated (flagged) · &lt;85 high · severe. The flag
threshold (45) is the band boundary — set by the scale, not tuned to the backtest.

## Validation, honestly stated

- **Retrospective (blind):** 13 real settled disputes, engine sees only pre-settlement
  rules text. Recall 9/12 = **75% (95% CI 47–91%)** at the pre-registered threshold; the
  single clean-text control at 20 (low band); per-case scores + threshold sweep committed in
  [`data/backtest-results.json`](../data/backtest-results.json). Full table, misses, and
  limits (small n, recall-not-precision, world-knowledge leakage): [BACKTEST.md](BACKTEST.md).
- **Forward (live):** every scored market's prediction is locked *while the market is
  still open* — score, band, rules-lean, and entry price — then graded automatically
  against the platform's actual settlement. Edges grade as paper trades (win/loss + P&L);
  risk scores grade on calibration (did flagged markets surprise?). No rate is displayed
  until n ≥ 20. Look-ahead is structurally blocked: closed markets can't be snapshotted,
  and grading never touches the settled price as a stand-in entry.

## How this maps to a resolution/escalation desk

1. **Pre-listing rules review** — the five dimensions are a structured checklist for
   drafting or vetting contract terms; the offending-clause output is the redline.
2. **Live monitoring** — the board ranks open markets by resolution risk and flags
   *edges*: markets where the literal rules lean against the crowd's price. That gap is
   where trader complaints (and lawsuits) come from.
3. **Post-resolution audit** — the track record is exactly an escalations post-mortem
   loop: prediction locked, outcome recorded with provenance (Kalshi settlement status,
   Polymarket UMA state), calibration reported with intervals.

The venues already operate the machinery this models: Kalshi's **Outcome Review
Committee** (quoted in the Khamenei rules themselves) and Polymarket's **UMA oracle**
dispute flow. Litmus is a systematic front-end to the question both processes exist to
answer after the fact — *could this rules text have been read two ways?* — asked before.

## What it deliberately does not do

- It does **not** predict events. A market can be a near-certain Yes and still be a
  resolution deathtrap; Litmus prices only the deathtrap.
- It does **not** claim precision yet — the gold-set is nearly all positives. A
  representative clean-market sample is the named next validation step.
- It is **not** an oracle: the score is a flag with a quoted clause, and the last step —
  "can this technicality actually happen?" — belongs to the human.
