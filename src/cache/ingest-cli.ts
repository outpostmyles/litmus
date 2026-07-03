import { ingestKalshi, ingestPolymarket } from './ingest'
import { saveCatalog, loadScores, type CatalogEntry } from './store'
import { appendPrices } from './prices'

const kalshiMin = Number(process.env.KALSHI_MIN_CONTRACTS || '10000')
const polyMin = Number(process.env.POLY_MIN_VOLUME || '100000')
const maxPer = Number(process.env.INGEST_MAX || '90')

async function main(): Promise<void> {
  console.log(
    `\n  Ingesting important markets — Kalshi ≥ ${kalshiMin.toLocaleString()} contracts, Polymarket ≥ $${polyMin.toLocaleString()}…\n`,
  )
  const [k, p] = await Promise.all([
    ingestKalshi(kalshiMin, maxPer).catch((e) => {
      console.error('  kalshi ingest failed:', e instanceof Error ? e.message : e)
      return [] as CatalogEntry[]
    }),
    ingestPolymarket(polyMin, maxPer).catch((e) => {
      console.error('  polymarket ingest failed:', e instanceof Error ? e.message : e)
      return [] as CatalogEntry[]
    }),
  ])

  const all = [...k, ...p]
  saveCatalog(all)
  const hist = appendPrices(all)

  const scores = loadScores()
  const hashes = new Set(all.map((e) => e.rulebookHash))
  const unscored = [...hashes].filter((h) => !scores[h]).length

  console.log(`  Kalshi: ${k.length} rulebooks  ·  Polymarket: ${p.length} rulebooks`)
  console.log(`  catalog saved: ${all.length} entries, ${hashes.size} distinct rulebooks`)
  console.log(`  price history: +${hist.appended} points (${hist.series} series)`)
  console.log(`  unscored: ${unscored}  →  run \`npm run backfill\``)
  console.log(
    `  est. cost to score the unscored: ~$${(unscored * 0.05).toFixed(2)} (Opus) / ~$${(unscored * 0.02).toFixed(2)} (Sonnet)\n`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
