import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../lib/env'
import { scoreMarket } from '../engine/score'
import { confirmLargeRun, budgetAllows, spendSummary } from '../lib/spend'
import { loadCatalog, loadScores, saveScores, type CachedScore } from './store'
import type { MarketInput } from '../engine/types'

const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY || '4')
// Cost guard: 0 = score everything unscored; >0 = cap to the N highest-volume rulebooks.
const MAX = Number(process.env.BACKFILL_MAX || '0')

async function main(): Promise<void> {
  const catalog = loadCatalog()
  if (!catalog.length) {
    console.log('\n  No catalog yet. Run `npm run ingest` first.\n')
    return
  }

  const scores = loadScores()
  // One job per distinct unscored rulebook, highest aggregate volume first.
  const seen = new Set<string>()
  let todo = catalog
    .filter((e) => !scores[e.rulebookHash] && !seen.has(e.rulebookHash) && (seen.add(e.rulebookHash), true))
    .sort((a, b) => b.totalVolume - a.totalVolume)
  if (MAX > 0) todo = todo.slice(0, MAX)

  if (!todo.length) {
    console.log(`\n  Everything in the catalog is already scored (${Object.keys(scores).length} rulebooks cached). ✓\n`)
    return
  }

  // Cost controls: >50 items needs explicit confirmation; the daily budget is a
  // hard stop that defers (never silently drops) the remainder.
  if (!(await confirmLargeRun(todo.length, todo.length * 0.05, 'backfill'))) return

  const cfg = getConfig()
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  console.log(`\n  Scoring ${todo.length} rulebooks on ${cfg.model}  (~$${(todo.length * 0.05).toFixed(2)} on Opus)…\n`)

  let done = 0
  let errored = 0
  let deferred = 0
  let next = 0
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const budget = budgetAllows()
      if (!budget.ok) {
        deferred += todo.length - next
        next = todo.length
        console.log(`  budget exhausted — deferring the remaining ${deferred} rulebooks to a later run.`)
        return
      }
      const e = todo[next++]!
      const market: MarketInput = {
        platform: e.platform,
        marketId: e.marketId,
        question: e.question,
        resolutionText: e.resolutionText,
        resolutionSource: e.resolutionSource,
        closeDate: e.closeDate,
        outcomes: e.outcomes,
      }
      try {
        const s = await scoreMarket(market, { client })
        scores[e.rulebookHash] = {
          combined: s.combined,
          band: s.band,
          dimensions: s.dimensions,
          namedSource: s.namedSource,
          assumedVsActual: s.assumedVsActual,
          headlineRisk: s.headlineRisk,
          summary: s.summary,
          model: s.model,
          scoredAt: new Date().toISOString(),
          scanLane: 'daily',
          verdict: s.verdict,
        } satisfies CachedScore
        saveScores(scores) // incremental → resumable if interrupted
        done++
        process.stdout.write(`  ${String(s.combined).padStart(3)}  ${e.question.slice(0, 56)}\n`)
      } catch (err) {
        errored++
        process.stdout.write(`  err  ${e.question.slice(0, 56)} — ${err instanceof Error ? err.message : String(err)}\n`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()))
  console.log(
    `\n  Scored ${done}${errored ? ` (${errored} errored)` : ''}${deferred ? ` (${deferred} deferred — budget)` : ''}. Cache now holds ${Object.keys(scores).length} rulebooks. ${spendSummary()}.\n`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
