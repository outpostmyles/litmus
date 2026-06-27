import { readFileSync } from 'node:fs'
import { MarketInputSchema, type MarketInput } from './types'
import { scoreMarket, type LitmusScore } from './score'
import { riskBand, type RiskBand } from './weights'
import { fetchKalshiMarket } from '../platforms/kalshi'
import { fetchPolymarketMarket } from '../platforms/polymarket'

const BAND_LABEL: Record<RiskBand, string> = {
  low: 'LOW',
  moderate: 'MODERATE',
  elevated: 'ELEVATED',
  high: 'HIGH',
  severe: 'SEVERE',
}

function bar(score: number, width = 24): string {
  const filled = Math.round((score / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function render(market: { question: string; platform: string }, score: LitmusScore): string {
  const out: string[] = []
  out.push('')
  out.push(`  ${market.question}`)
  out.push(`  ${market.platform}`)
  out.push('')
  out.push(`  RESOLUTION RISK  ${score.combined}/100   [${BAND_LABEL[score.band]}]`)
  out.push(`  ${bar(score.combined, 40)}`)
  out.push('')
  for (const d of score.dimensions) {
    out.push(`  ${d.label.padEnd(26)} ${bar(d.score)} ${String(d.score).padStart(3)}`)
    out.push(`    ${d.reasoning}`)
    if (d.offendingClause) out.push(`    └ "${d.offendingClause}"`)
    out.push('')
  }
  if (score.namedSource) out.push(`  Source of truth: ${score.namedSource}`)
  else out.push(`  Source of truth: (none named)`)
  if (score.assumedVsActual) out.push(`  ${score.assumedVsActual}`)
  out.push('')
  out.push(`  ⚑ Headline risk: ${score.headlineRisk}`)
  out.push('')
  out.push(`  ${score.summary}`)
  out.push('')
  out.push(
    `  [model ${score.model} · ${score.usage.inputTokens}→${score.usage.outputTokens} tok]`,
  )
  out.push('')
  return out.join('\n')
}

async function resolveMarket(): Promise<MarketInput> {
  const argv = process.argv.slice(2)
  const flagIdx = argv.findIndex((a) => a === '--kalshi' || a === '--polymarket')
  if (flagIdx >= 0) {
    const flag = argv[flagIdx]
    const id = argv[flagIdx + 1]
    if (!id) throw new Error(`Provide a market identifier after ${flag} (a ticker, slug, or URL).`)
    process.stderr.write(`  fetching live ${flag === '--kalshi' ? 'Kalshi' : 'Polymarket'} market: ${id}\n`)
    return flag === '--kalshi' ? fetchKalshiMarket(id) : fetchPolymarketMarket(id)
  }
  // Otherwise: a JSON file path, or stdin.
  const path = argv.find((a) => !a.startsWith('--'))
  const raw = path && path !== '-' ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8')
  return MarketInputSchema.parse(JSON.parse(raw))
}

async function main(): Promise<void> {
  const market = await resolveMarket()
  const score = await scoreMarket(market)
  // riskBand re-exported only to keep the import surface honest if rendering moves.
  void riskBand
  process.stdout.write(render(market, score))
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`\n  Litmus error: ${message}\n`)
  process.exit(1)
})
