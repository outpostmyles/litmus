import { loadCatalog, loadScores, type CatalogEntry } from '@/src/cache/store'
import { loadPrices, priceDeltas } from '@/src/cache/prices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // always read the latest cache from disk

export async function GET() {
  const catalog = loadCatalog()
  const scores = loadScores()
  const prices = loadPrices()

  // Group by rulebook (defensive — ingest already dedupes per platform).
  const byHash = new Map<string, CatalogEntry>()
  for (const e of catalog) {
    const g = byHash.get(e.rulebookHash)
    if (!g) {
      byHash.set(e.rulebookHash, { ...e })
    } else {
      const totalVolume = g.totalVolume + e.totalVolume
      const marketCount = g.marketCount + e.marketCount
      if (e.volume > g.volume) byHash.set(e.rulebookHash, { ...e, totalVolume, marketCount })
      else {
        g.totalVolume = totalVolume
        g.marketCount = marketCount
      }
    }
  }

  const now = Date.now()
  const items = [...byHash.values()].map((e) => {
    const series = prices[e.rulebookHash]
    const { d1, d7 } = priceDeltas(series, e.priceYes ?? null, now)
    return {
      rulebookHash: e.rulebookHash,
      platform: e.platform,
      marketId: e.marketId,
      question: e.question,
      category: e.category,
      resolutionText: e.resolutionText,
      resolutionSource: e.resolutionSource,
      outcomes: e.outcomes,
      closeDate: e.closeDate,
      volume: e.totalVolume,
      marketCount: e.marketCount,
      priceYes: e.priceYes ?? null,
      priceAsOf: e.priceAsOf ?? null,
      /** Price change vs ~24h / ~7d ago (needs history to reach back that far). */
      delta1d: d1,
      delta7d: d7,
      /** Recent price series for the sparkline (last 30 points). */
      history: series ? series.slice(-30) : [],
      url: e.url,
      scanLane: e.scanLane ?? 'daily',
      detectedAt: e.detectedAt ?? null,
      score: scores[e.rulebookHash] ?? null,
    }
  })

  const scored = items.filter((i) => i.score)
  scored.sort((a, b) => (b.score?.combined ?? 0) - (a.score?.combined ?? 0))

  // Freshness: the newest successful fetch across the catalog. The UI shows this and
  // warns when the daily job has evidently not run.
  const dataAsOf = catalog.reduce<string | null>((acc, e) => (!acc || e.fetchedAt > acc ? e.fetchedAt : acc), null)

  return Response.json({
    items: scored,
    totalRulebooks: byHash.size,
    scoredCount: scored.length,
    unscoredCount: byHash.size - scored.length,
    dataAsOf,
  })
}
