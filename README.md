# Litmus

**A resolution-risk scanner for prediction markets.** Litmus reads the resolution
criteria on live Kalshi and Polymarket markets and scores how likely each one is to
settle *differently than traders expect* — surfacing the markets where the written
outcome and the assumed outcome can diverge.

> Resolution is the part of prediction markets that actually blows up, and almost
> nobody prices it systematically.

Start here: **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)** (the one-page why/how) ·
**[docs/BACKTEST.md](docs/BACKTEST.md)** (validation, with confidence intervals) ·
the in-app **/cases** gallery (real disputes, scored blind).

## The scoring engine

Each market's resolution text is scored on five dimensions (0–100), then combined in
code into a single risk score, with a plain-English explanation and the exact offending
clause quoted back:

| Dimension | What it catches |
|---|---|
| **Source clarity** | Is the source of truth named and authoritative, or is it "vibes"? |
| **Criteria precision** | Is the threshold/event unambiguously defined? (rounding, "a cut", timezones) |
| **Literal-vs-intuitive gap** | Would a casual reader assume a different outcome than the text dictates? |
| **Timing risk** | Can the resolving event be delayed, extended, or contested? |
| **Dispute surface** | Does resolution require subjective judgment / multiple plausible readings? |

## The app

`npm run dev` → four surfaces:

- **Lookup** (`/`) — paste a Kalshi ticker / Polymarket slug / raw rules text, get the
  gauge, five dimensions, the offending clauses, and the trade-signal chips.
- **Board** (`/board`) — the cached universe ranked by risk: filters, edges (rules-lean
  vs crowd price), price momentum sparklines, watchlist stars, freshness banner.
- **Pairs** (`/pairs`) — cross-venue divergence: when Kalshi and Polymarket list the
  same real-world event, Litmus diffs their rulebooks clause by clause and names the
  concrete scenario under which one venue pays Yes and the other No — the check that
  decides whether a cross-venue price gap is an arb or a trap.
- **Track** (`/track`) — the live forward record: every prediction locked at first sight
  on open markets, graded automatically on settlement. Paper-trade P&L for edges,
  calibration for risk scores, rates gated until n ≥ 20. Locked cross-venue pairs
  grade on whether both venues settled identically.
- **Cases** (`/cases`) — the gold-set gallery: 13 real disputes, what traders assumed,
  what actually happened, and Litmus's blind score of the original rules.

## The pipeline (zero-cost daily loop)

```bash
npm run ingest       # pull high-volume markets + live prices; append price history (free)
npm run backfill     # score any new rulebooks once (paid — the main step that costs)
npm run enrich       # cheap Haiku pass: directional lean + confidence  (--force to redo)
npm run crossvenue   # match cross-venue pairs + diff their rules (paid, cached by pair)
npm run snapshot     # lock predictions for newly scored OPEN markets (free)
npm run settle       # record outcomes for closed markets, with provenance (free)
npm run pairs-settle # grade locked pairs when both legs settle (free)
npm run alerts       # closing-soon + fresh-edge alerts, macOS notification (free)
```

A launchd job (`scripts/com.litmus.daily.plist`) runs ingest → snapshot → settle →
alerts daily. Scores are cached by a hash of the rulebook text, so fan-out markets
(every "Will X win?" leg) collapse to a single model call, and nothing is ever
re-scored. Cost knobs: `KALSHI_MIN_CONTRACTS`, `POLY_MIN_VOLUME`, `INGEST_MAX`,
`BACKFILL_MAX`, `LEAN_MODEL`.

## Validation

On a vetted gold-set of real resolution disputes scored blind, Litmus flagged
**9 of 12 (75%, 95% CI 47–91%)** markets whose ambiguity was present in the rules
text, scored the control case 20 (low band), and showed a 35-point mean-risk separation.
Every percentage carries its n and interval; the limits (small sample, recall-not-
precision, leakage caveats) are stated plainly in [docs/BACKTEST.md](docs/BACKTEST.md).
The forward track record accumulates automatically as tracked markets settle.

## CLI

```bash
npm run score -- --kalshi KXELONMARS-99
npm run score -- --polymarket will-egypt-win-the-2026-fifa-world-cup
npm run score -- data/fixtures/sample-market.json
npm run scan  -- --kalshi --category Politics --limit 12   # --dry to list for free
npm run backtest                                           # re-run the gold-set blind
```

Both platforms' market-data reads are public — no platform keys. The engine needs
`ANTHROPIC_API_KEY` in `.env` (copy `.env.example`).

## Stack

Next.js (App Router) + TypeScript + Tailwind. Engine modules are plain TS (run via
`tsx`) so the backtest, the CLIs, and the web app share one scoring core. All state is
local JSON under `data/cache/` (gitignored) — no accounts, no database.
