import { writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../lib/env'
import { scoreMarket, type LitmusScore } from '../engine/score'
import type { MarketInput } from '../engine/types'
import { listKalshiMarkets } from '../platforms/kalshi'
import { listPolymarketMarkets } from '../platforms/polymarket'

const CONCURRENCY = 4

function flagValue(name: string): string | undefined {
  const a = process.argv.slice(2)
  const i = a.indexOf(name)
  return i >= 0 ? a[i + 1] : undefined
}
function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name)
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()))
  return results
}

const USAGE = `
  usage:
    npm run scan -- --polymarket [--limit N] [--query "world cup"] [--event <slug>]
    npm run scan -- --kalshi [--category Economics] [--limit N]
`

async function main(): Promise<void> {
  const platform = hasFlag('--kalshi') ? 'kalshi' : hasFlag('--polymarket') ? 'polymarket' : null
  if (!platform) {
    console.log(USAGE)
    return
  }
  const limit = Math.max(1, Number(flagValue('--limit') || '12'))

  let config
  try {
    config = getConfig()
  } catch (err) {
    console.log(`\n  ${err instanceof Error ? err.message : String(err)}\n`)
    return
  }

  console.log(`\n  Litmus scan — fetching live ${platform} markets…`)
  const markets: MarketInput[] =
    platform === 'kalshi'
      ? await listKalshiMarkets({ category: flagValue('--category'), limit })
      : await listPolymarketMarkets({ limit, query: flagValue('--query'), event: flagValue('--event') })

  if (!markets.length) {
    console.log('  no markets matched those filters.\n')
    return
  }
  if (hasFlag('--dry')) {
    console.log(`  ${markets.length} markets (dry run — not scored):`)
    markets.forEach((m, i) => console.log(`  ${String(i + 1).padStart(2)}. [${m.platform}] ${m.question.slice(0, 70)}`))
    console.log('')
    return
  }
  console.log(`  scoring ${markets.length} markets (≈ $${(markets.length * 0.05).toFixed(2)})…\n`)

  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL })
  const scored = (
    await mapPool(markets, CONCURRENCY, async (m) => {
      try {
        const s = await scoreMarket(m, { client })
        process.stdout.write(`  ${String(s.combined).padStart(3)}  ${m.question.slice(0, 56)}\n`)
        return { m, s }
      } catch (err) {
        process.stdout.write(`  err  ${m.question.slice(0, 56)} — ${err instanceof Error ? err.message : String(err)}\n`)
        return null
      }
    })
  ).filter((r): r is { m: MarketInput; s: LitmusScore } => r !== null)

  scored.sort((a, b) => b.s.combined - a.s.combined)

  console.log('\n  RANKED RESOLUTION RISK')
  console.log('  ' + '─'.repeat(80))
  scored.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${String(r.s.combined).padStart(3)} ${r.s.band.padEnd(9)} [${r.m.platform}] ${r.m.question.slice(0, 54)}`,
    )
    console.log(`       ⚑ ${r.s.headlineRisk.slice(0, 92)}`)
  })
  console.log('  ' + '─'.repeat(80))

  writeFileSync(
    'data/scan-results.json',
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        platform,
        count: scored.length,
        board: scored.map((r) => ({
          combined: r.s.combined,
          band: r.s.band,
          platform: r.m.platform,
          marketId: r.m.marketId,
          question: r.m.question,
          namedSource: r.s.namedSource,
          headlineRisk: r.s.headlineRisk,
        })),
      },
      null,
      2,
    ),
  )
  console.log(`  (full board written to data/scan-results.json)\n`)
}

main().catch((err: unknown) => {
  console.error(`\n  scan error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
