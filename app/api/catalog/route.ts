import { loadCatalog, loadScores, type CatalogEntry } from '@/src/cache/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // always read the latest cache from disk

export async function GET() {
  const catalog = loadCatalog()
  const scores = loadScores()

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

  const items = [...byHash.values()].map((e) => ({
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
    url: e.url,
    score: scores[e.rulebookHash] ?? null,
  }))

  const scored = items.filter((i) => i.score)
  scored.sort((a, b) => (b.score?.combined ?? 0) - (a.score?.combined ?? 0))

  return Response.json({
    items: scored,
    totalRulebooks: byHash.size,
    scoredCount: scored.length,
    unscoredCount: byHash.size - scored.length,
  })
}
