# Litmus

**Prediction-market prices track the event. Contracts pay out on the rules text.** The gap between those two things is measurable, tradeable risk that no venue surfaces — when Kalshi's Khamenei market settled at the pre-strike price under a death carveout instead of paying YES, traders who were right about the event lost anyway, and a $54M class action followed.

Litmus scores that gap across high-volume Kalshi and Polymarket markets, then grades its own predictions in public as those markets settle.

## Results

**Blind retrospective backtest** — 13 real historical settlement disputes, scored only on their pre-settlement rules text. The engine never sees the outcome; the answer key lives in a separate field it is never passed.

| Metric | Result |
|---|---|
| Recall at the pre-registered threshold (≥45) | **9/12 = 75%** (Wilson 95% CI 47–91%) |
| Mean risk separation, disputes vs. control | 55 vs. 20 (**35 points**) |
| Clean-text control (mis-settled for reasons outside the text) | scored 20 — correctly unflagged (n=1) |
| Reason precision (flagged the specific known failure dimensions) | 27/51 = 53% |

A prior prompt version scored 10/12 = 83%; both runs are disclosed in [docs/BACKTEST.md](docs/BACKTEST.md). **You can check these numbers yourself in one command, with no API key** — see [Verify the results](#verify-the-results).

**Live forward ledger** — running since **June 29, 2026**; snapshot below taken **October 1, 2026**. These numbers move as markets settle, so a later run will not match exactly; regenerate them yourself with `npm run track:stats`.

- **286 predictions locked, 97 settled**, each graded automatically on settlement with per-grade provenance (the venue status string that produced the outcome is stored on the row).
- **Contested settlements: 7 markets have gone to contested resolution, and Litmus had flagged 4 of the 7 at lock time** (scores 55–62; n=7, stated as counts because the sample is small). One of them — "Will China invades Taiwan before GTA VI?" (the venue's own title) — had its exact trap clause (*"If neither occurs by July 31, 2026, 11:59 PM ET, this market will resolve to 50-50."*) quoted by the tool while the market was still open. Settlement-process outcomes so far: 87 clean, 3 delayed, 7 contested.
- Risk calibration: 6 of 13 surprises caught, 24 false alarms (n=81 graded). Four of the six catches come from the same correlated family of "before GTA VI" markets, so this is thinner evidence than the count suggests.
- Crowd-price Brier **0.0929** vs. Litmus-adjusted **0.0961** (n=88): **the market is currently beating the tool** on its own published benchmark. That comparison is displayed in the app, not just here.
- Paper-trade edges, segmented by the rule that made each call: the retired rule is 1W–19L, −0.40u — its single mid-priced win doesn't cover the penny-longshot losses that motivated retiring it. The current rule is 1W–4L, −0.04u, with 2 open; its one win was YES on "US x Iran Effective Ceasefire by July 31?" bought at 21¢ on the rules text (+0.80u). That is five trades — **below the n=20 reporting gate**, and the app labels it that way rather than reporting a rate.
- Cross-venue: 20 same-claim contract pairs matched leg-by-leg across both venues; all 20 settled identically (World Cup Golden Boot, concluded). The pipeline graded every pair — no split settlement occurred.

## What would be hard to fake

A hiring manager's reasonable prior in 2026 is that an AI-assisted project was generated in a weekend. These are the parts of this repo that a weekend cannot produce:

- **Elapsed time.** The forward ledger has been accumulating since June 29, 2026 and grades itself through a scheduled job that has run on 92 of the 95 days since. A locked prediction records the price at lock and is never rewritten — the row is a timestamped commitment, not a retrospective claim.
- **Published losses.** The tool is currently *losing* to the crowd on its own Brier benchmark, and the retired edge rule's 1–19 record is displayed next to the current rule's 1–4 rather than deleted. Both are on the Track page and in this README.
- **Self-imposed constraints that cost accuracy.** Predictions lock only while markets are open; grading never touches settled prices; markets that are closed, stale-priced, or unverifiably open are *refused* at lock time (`src/track/lock.ts`, one shared code path for both ingest lanes, with regression tests). Each constraint discards data that would have flattered the record.
- **Adversarial audit with documented repairs.** Three real look-ahead bugs were found and fixed during development: post-close snapshots, a settled-price fallback in grading, and null-close-date "free wins" on effectively-decided markets. Tainted rows were purged and the taint documented in commit history rather than quietly dropped.
- **Rates gated on sample size.** The UI refuses to display a win rate or recall percentage below n=20 and shows "building sample" instead. Wilson confidence intervals accompany every published proportion.

## Verify the results

The backtest artifact and all 13 fixtures are committed, so the headline numbers can be recomputed offline:

```bash
npm install
npm run verify      # no API key, no model calls
```

This recomputes recall at every threshold with confidence intervals, mean separation, reason precision, and a blindness check that no fixture's outcome narrative appears in what the engine was fed. Compare the output against the table above and against [docs/BACKTEST.md](docs/BACKTEST.md).

To re-run the actual scoring against the live model (requires `ANTHROPIC_API_KEY`, ~$0.65): `npm run backtest`. LLM output is stochastic, so scores will vary slightly between runs — [docs/BACKTEST.md](docs/BACKTEST.md) discusses this and the prompt-version change that moved recall from 10/12 to 9/12.

## Screenshots

<!-- Add the images (see docs/img/README.md for capture instructions), then uncomment:
### The ledger, grading itself
![Track page — locked predictions, the v2/v3 edge split, and the crowd-vs-Litmus Brier comparison](docs/img/track.png)

### The scored universe
![Board — every high-volume market ranked by live risk](docs/img/board.png)

### Cross-venue rule divergence
![Pairs — the same event on both venues, rules diffed clause by clause](docs/img/pairs.png)
-->

_Screenshots pending — run `npm run dev` to see the six pages locally (board · pairs · world cup · track · cases · guide)._

## How it works

- Pipeline: ingest both venues' public APIs → score each unique rulebook once (cached by a hash of the rules text — nothing is paid for twice) → lock predictions → settle → grade. Ingest, settlement and grading run on a daily schedule at zero model cost; scoring new rulebooks is a separate, budget-capped step (a manual backfill, or a fast-scan daemon that catches new listings within minutes).
- The **LLM reads the rules and does two things**: it rates five risk dimensions (source clarity, criteria precision, literal-vs-intuitive gap, timing, dispute surface) and quotes the clause behind each rating. **Everything downstream is deterministic, audited code** — the combined score, flagging, edge gating, pair risk, calibration, and every track-record metric. The model never sees outcomes and never grades its own calls.
- Cross-venue matching works at the individual-contract level: deterministic candidate blocking, LLM same-event confirmation with an explicit fan-out-trap rule, then per-leg entity matching, producing verbatim clause diffs and a concrete "scenario that splits the venues."
- The fast display layer is gated in code, not prompts: a verdict's killer clause must appear **verbatim** in the rules or the lean collapses to UNCLEAR; a divergence score is hard-capped without a concrete split scenario; edges at extreme prices require quote-the-clause confidence.

## Honest limitations

Every metric above is small-sample; the confidence intervals are wide and quoted for that reason. The precision-recall tradeoff is unresolved — the backtest set is nearly all positives, and the live false-alarm count shows it. The current edge rule has five settled trades (one win). The 4-of-7 contested-settlement hit rate is seven data points from one related market family, not a validated rate. The app runs end-to-end but locally only: no deployment, no auth, no database; alerts are desktop notifications. The market is ahead on Brier and the Track page says so.

## Stack and scale

TypeScript throughout — Next.js app over a framework-agnostic plain-TS engine shared with CLIs and the backtest harness. Anthropic API with structured outputs (Opus for rubric scoring and rule-diffing, Haiku for cheap passes), Kalshi and Polymarket public APIs, local JSON state with atomic writes. ~10,000 lines across 82 files, 72 tests covering the correctness-critical paths (locking invariants, verdict gates, matching, pair-risk math).

Model spend is metered per call against a hard daily cap: `npm run spend` reports **$6.99** recorded since the spend ledger was instrumented (roughly $22 including earlier uninstrumented runs). Scoring halts when the cap is hit; grading and locking are free and never blocked.

## Where to look in the code

| If you want to check… | Read |
|---|---|
| That look-ahead is actually impossible | [`src/track/lock.ts`](src/track/lock.ts) — the single locking path, plus its regression tests |
| That the numbers aren't the model's opinion | [`src/engine/weights.ts`](src/engine/weights.ts) — deterministic score combination |
| That the short verdicts can't overclaim | [`src/engine/verdict.ts`](src/engine/verdict.ts) — the verbatim-quote gate |
| How cross-venue matching avoids false pairs | [`src/engine/crossvenue/legs.ts`](src/engine/crossvenue/legs.ts) — unique assignment, ambiguity matches nothing |
| The rubric itself | [`src/engine/prompt.ts`](src/engine/prompt.ts) |

## Run it

```bash
npm install && cp .env.example .env   # add ANTHROPIC_API_KEY
npm run verify                        # check the published backtest — no key needed
npm run dev                           # the six pages, served from cached data

npm run ingest && npm run backfill    # pull markets, score new rulebooks (paid, cached)
npm run backtest                      # re-run the blind backtest against the live model
npm run track:stats                   # regenerate the live-ledger numbers above
npm run spend                         # per-stage API cost and cache-hit report
npm test                              # 72 tests
```

Methodology one-pager: [docs/METHODOLOGY.md](docs/METHODOLOGY.md) · Backtest detail and limits: [docs/BACKTEST.md](docs/BACKTEST.md)
