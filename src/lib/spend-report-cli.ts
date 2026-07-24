import { readFileSync, existsSync } from 'node:fs'
import { SPEND_PATH, dailyBudgetUsd, type DayRecord } from './spend'

// Cost report: per-day, per-stage dollars, call counts, and prompt-cache hit rate.
// `npm run spend`  — the answer to "where is the money going, and is caching working?"

function main(): void {
  if (!existsSync(SPEND_PATH)) {
    console.log('\n  No spend recorded yet.\n')
    return
  }
  const ledger = JSON.parse(readFileSync(SPEND_PATH, 'utf8')) as Record<string, DayRecord>
  const days = Object.keys(ledger).sort()
  let total = 0

  console.log(`\n  LITMUS SPEND  ·  budget $${dailyBudgetUsd()}/day\n`)
  console.log(`  ${'stage'.padEnd(22)} ${'calls'.padStart(6)} ${'$'.padStart(8)} ${'cache hit'.padStart(10)}`)
  console.log('  ' + '─'.repeat(50))

  const rollup: Record<string, { usd: number; calls: number; cacheRead: number; inTok: number }> = {}
  for (const day of days) {
    total += ledger[day]!.usd
    for (const [stage, s] of Object.entries(ledger[day]!.stages)) {
      const r = (rollup[stage] ??= { usd: 0, calls: 0, cacheRead: 0, inTok: 0 })
      r.usd += s.usd
      r.calls += s.calls
      r.cacheRead += s.cacheRead ?? 0
      r.inTok += s.inTok
    }
  }

  for (const [stage, r] of Object.entries(rollup).sort((a, b) => b[1].usd - a[1].usd)) {
    // Hit rate = share of input tokens served from cache. "—" = no cache tokens logged
    // (either a run before this instrumentation, or a prompt below the cache minimum).
    const hitStr = r.cacheRead > 0 && r.inTok > 0 ? `${Math.round((r.cacheRead / r.inTok) * 100)}%` : '—'
    console.log(`  ${stage.padEnd(22)} ${String(r.calls).padStart(6)} ${('$' + r.usd.toFixed(2)).padStart(8)} ${hitStr.padStart(10)}`)
  }
  console.log('  ' + '─'.repeat(50))
  console.log(`  ${'lifetime'.padEnd(22)} ${''.padStart(6)} ${('$' + total.toFixed(2)).padStart(8)}\n`)
  console.log('  Prompt caching applies only to Opus rubric scoring (system prompt >1024 tok);')
  console.log('  the cache-hit column populates on the next scoring run. Haiku passes (lean,')
  console.log('  verdict, match) have short prompts below the cache minimum, so caching cannot')
  console.log('  apply there — but those are the cheapest calls (see the $ column).\n')
}

main()
