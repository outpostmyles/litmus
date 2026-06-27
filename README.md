# Litmus

**A resolution-risk scanner for prediction markets.** Litmus reads the resolution
criteria on live Kalshi and Polymarket markets and scores how likely each one is to
settle *differently than traders expect* — surfacing the markets where the written
outcome and the assumed outcome can diverge.

> Resolution is the part of prediction markets that actually blows up, and almost
> nobody prices it systematically.

## The scoring engine

Each market's resolution text is scored on five dimensions (0–100), then weighted into
a combined risk score, with a plain-English explanation and the exact offending clause:

| Dimension | What it catches |
|---|---|
| **Source clarity** | Is the source of truth named and authoritative, or is it "vibes"? |
| **Criteria precision** | Is the threshold/event unambiguously defined? (rounding, "a cut", timezones) |
| **Literal-vs-intuitive gap** | Would a casual reader assume a different outcome than the text dictates? |
| **Timing risk** | Can the resolving event be delayed, extended, or contested? |
| **Dispute surface** | Does resolution require subjective judgment / multiple plausible readings? |

## Usage

```bash
# Score a live market — fetches resolution text from the public API and scores it
npm run score -- --kalshi KXELONMARS-99
npm run score -- --polymarket will-egypt-win-the-2026-fifa-world-cup   # slug or full URL
npm run score -- data/fixtures/sample-market.json                      # ...or a market JSON file

# Rank a live category by resolution risk — the "riskiest markets" board
npm run scan -- --kalshi --category Politics --limit 12
npm run scan -- --polymarket --query "election" --limit 12
npm run scan -- --polymarket --event <event-slug>                      # all markets in one event
#   add --dry to list candidates without scoring (free)

npm run backtest        # score the gold-set blind, print the hit-rate
```

Both platforms' market-data reads are public — the live lookup needs no platform keys.
The engine needs `ANTHROPIC_API_KEY` in `.env` (copy `.env.example`).

## Status

**Backtest-first, and the engine is validated.** On a vetted gold-set of real
resolution disputes scored blind, Litmus flagged **10 of 12 (83%)** markets whose
ambiguity was present in the rules text, left the control case unflagged, and showed a
28-point mean-risk separation between disputed and clean markets. See
[docs/BACKTEST.md](docs/BACKTEST.md).

- [x] **Phase 0 — Engine** · 5-dimension rubric, Opus 4.8 structured output, weighted combine
- [x] **Phase 0 — Backtest** · 13-case gold-set scored blind → 83% recall, 0 false positives on control
- [ ] **Phase B — Data layer** · pull live Kalshi markets (public API), store in Supabase
- [ ] **Phase C — UI** · ranked risk board + pre-trade single-market lookup
- [ ] **Phase D — Personal layer** · watchlist + alerts near resolution dates

## Stack

Next.js + TypeScript + Supabase. Engine modules are plain TS (run via `tsx`) so the
backtest and the eventual web app share one scoring core.
