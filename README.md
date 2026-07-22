# Litmus

Prediction-market prices track the **event**. Contracts pay out on the **rules text**. The gap between the two is measurable, tradeable risk that no venue surfaces — when Kalshi's Khamenei market settled at the pre-strike price under a death carveout instead of paying YES, traders who were right about the event lost anyway, and a $54M class action followed. Litmus reads the rules the way an escalations analyst would, scores that gap on every high-volume Kalshi and Polymarket market, and then grades its own predictions in public as markets settle.

## Results

**Blind retrospective backtest** — 13 real historical settlement disputes, scored only on their pre-settlement rules text (the engine never sees outcomes):

| Metric | Result |
|---|---|
| Recall at the pre-registered threshold (≥45) | **9/12 = 75%** (Wilson 95% CI 47–91%) |
| Mean risk separation, disputed vs. control | 55 vs. 20 (**35 points**) |
| Clean-text control case | scored 20 — correctly unflagged (n=1) |

A prior prompt version scored 10/12; both runs are disclosed in [docs/BACKTEST.md](docs/BACKTEST.md), and the committed [results artifact](data/backtest-results.json) reproduces the table without an API key.

**Live forward ledger** — as of July 22, 2026 (a running ledger; these numbers move as markets settle):

- **255 predictions locked, 47 settled**, graded automatically on settlement with per-grade provenance.
- Crowd-price Brier **0.0949** vs. Litmus-adjusted **0.0982** (n=45): **the market is currently beating the tool** on its own published benchmark.
- Risk calibration: 1 of 3 surprises caught, 14 false alarms (n=37 graded).
- Paper-trade edges, segmented by the rule that made each call: the retired rule went 1W–12L, +0.19u (profit from one mid-priced win; the losses were penny-longshot artifacts the rule was retired for). The current rule is 0W–1L with 4 open — essentially no settled sample yet.
- Cross-venue: 20 same-claim contract pairs locked across both venues, matched leg-by-leg; all 20 settled identically (World Cup Golden Boot, concluded) — the pipeline graded every pair, no split settlement occurred.

## Why look-ahead is impossible

The numbers above only mean something if the tool cannot cheat, so that is enforced structurally: predictions lock **while markets are open**; grading never touches settled prices; locked entries are **never rewritten**; markets that are closed, stale-priced, or unverifiably open are refused at lock time. All of it lives in one shared code path with regression tests. Three real look-ahead bugs were found by adversarial audit during development — post-close snapshots, a settled-price fallback in grading, and null-close-date "free wins." Each was repaired and the tainted rows were purged with the taint documented, not hidden.

## How it works

- Daily pipeline: ingest both venues' public APIs → score each unique rulebook once (cached by a hash of the rules text — nothing is paid for twice) → lock predictions → settle → grade. A fast-scan daemon catches new listings within minutes.
- The **LLM only reads text and quotes clauses** (five-dimension rubric: source clarity, criteria precision, literal-vs-intuitive gap, timing, dispute surface). **Every number is computed deterministically in audited code** — score combination, edge gating, pair risk, calibration.
- Cross-venue matching works at the individual-contract level: deterministic candidate blocking, LLM same-event confirmation with an explicit fan-out-trap rule, then per-leg entity matching, producing verbatim clause diffs and a concrete "scenario that splits the venues."
- The fast display layer is gated in code, not prompts: a verdict's killer clause must appear **verbatim** in the rules or the lean collapses to UNCLEAR; a divergence score is hard-capped without a concrete split scenario; edges at extreme prices require quote-the-clause confidence.

## Honest limitations

Every metric above is small-sample; the confidence intervals are wide and quoted for that reason. The precision-recall tradeoff is unresolved — the backtest set is nearly all positives, and the live false-alarm count shows it. The current edge rule has one settled trade. The app runs end-to-end but locally only: no deployment, no auth, no database; alerts are desktop notifications. The market is ahead on Brier and the Track page says so.

## Stack and scale

TypeScript throughout — Next.js app over a framework-agnostic plain-TS engine shared with CLIs and the backtest harness. Anthropic API with structured outputs (Opus for rubric scoring and rule-diffing, Haiku for cheap passes), Kalshi and Polymarket public APIs, local JSON state with atomic writes. ~9,600 lines, 79 files, 72 tests covering the correctness-critical paths (locking invariants, verdict gates, matching, pair-risk math). Roughly $20 of lifetime model spend under a hard $10/day budget cap with a per-call spend ledger.

## Run it

```bash
npm install && cp .env.example .env   # add ANTHROPIC_API_KEY
npm run ingest && npm run backfill    # pull markets, score new rulebooks (paid, cached)
npm run dev                           # board · pairs · world cup · track · cases · guide
npm run backtest                      # reproduce the blind backtest
```

Methodology one-pager: [docs/METHODOLOGY.md](docs/METHODOLOGY.md) · Backtest detail and limits: [docs/BACKTEST.md](docs/BACKTEST.md)
