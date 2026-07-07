import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../lib/env'
import { budgetAllows, spendSummary } from '../lib/spend'
import { tryGetJson } from '../lib/http'
import { scoreMarket } from '../engine/score'
import { rulebookHash, loadCatalog, saveCatalog, loadScores, saveScores, type CatalogEntry, type CachedScore } from './store'
import { appendPrices } from './prices'
import { fetchKalshiMarket } from '../platforms/kalshi'

// World Cup mode: targeted ingest of the tournament's market families on both
// venues, scored once per FAMILY (legs share the rules template — the same
// never-pay-twice insight as Kalshi fan-outs), tagged category "World Cup" so the
// /worldcup page can rank them by live risk. Idempotent; scoring is budget-gated.
//
//   npm run worldcup

const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'
const KB = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2'

const POLY_SLUGS = (
  process.env.WC_POLY_SLUGS ||
  'world-cup-winner,world-cup-nation-to-reach-final,world-cup-nation-to-reach-quarterfinals,which-continent-will-win-the-world-cup,world-cup-golden-boot-winner'
).split(',')

/** Optional Kalshi series to sweep (comma list), e.g. "KXWCGOALLEADER,KXWCIRAN". */
const KALSHI_SERIES = (process.env.WC_KALSHI_SERIES || 'KXWCGOALLEADER,KXWCIRAN,KXCLUBWC').split(',').filter(Boolean)

function polyFamilyEntry(ev: any): CatalogEntry | null {
  const markets: any[] = ev?.markets ?? []
  if (!markets.length) return null
  const legs = markets
    .map((x: any) => {
      let priceYes: number | null = null
      try {
        const op = typeof x.outcomePrices === 'string' ? JSON.parse(x.outcomePrices) : x.outcomePrices
        const p = Array.isArray(op) && op[0] != null ? Number(op[0]) : NaN
        if (p > 0 && p < 1) priceYes = p
      } catch {
        /* none */
      }
      return {
        marketId: String(x.id ?? ''),
        label: String(x.groupItemTitle || x.question || ''),
        priceYes,
        volume: Number(x.volumeNum || 0),
        description: String(x.description || ''),
        endDate: x.endDate || x.endDateIso || null,
        active: x.closed !== true,
      }
    })
    .filter((l) => l.marketId && l.label && l.active)
  if (!legs.length) return null
  const rep = [...legs].sort((a, b) => b.volume - a.volume)[0]!
  if (!rep.description || rep.description.trim().length <= 40) return null
  const totalVolume = legs.reduce((s, l) => s + l.volume, 0)
  // Close date = the LATEST leg deadline — the tournament, not one team's exit. A
  // per-leg endDate would let look-ahead guards think the family already closed.
  const closeDate =
    legs
      .map((l) => l.endDate)
      .filter((d): d is string => !!d && Number.isFinite(Date.parse(d)))
      .sort()
      .pop() ??
    rep.endDate ??
    null
  return {
    platform: 'Polymarket',
    marketId: rep.marketId,
    rulebookHash: rulebookHash('Polymarket', rep.description.trim()),
    question: ev.title || ev.slug,
    category: 'World Cup',
    resolutionText: rep.description.trim(),
    resolutionSource: null,
    outcomes: ['Yes', 'No'],
    closeDate,
    volume: totalVolume,
    marketCount: legs.length,
    totalVolume,
    priceYes: rep.priceYes,
    priceAsOf: new Date().toISOString(),
    url: ev.slug ? `https://polymarket.com/event/${ev.slug}` : null,
    fetchedAt: new Date().toISOString(),
    scanLane: 'fast', // survives the daily volume sweep via the fast-lane keep rule
    detectedAt: new Date().toISOString(),
    legs: legs.map(({ marketId, label, priceYes, volume }) => ({ marketId, label, priceYes, volume })),
  }
}

async function main(): Promise<void> {
  const catalog = loadCatalog()
  const byHash = new Map(catalog.map((e) => [e.rulebookHash, e]))
  let added = 0
  let refreshed = 0

  for (const slug of POLY_SLUGS) {
    const ev = await tryGetJson(`${GAMMA}/events?slug=${encodeURIComponent(slug.trim())}`)
    const event = Array.isArray(ev) ? ev[0] : ev
    const entry = event ? polyFamilyEntry(event) : null
    if (!entry) {
      console.log(`  (no usable event for slug ${slug})`)
      continue
    }
    const existing = byHash.get(entry.rulebookHash)
    if (existing) {
      // Refresh in place AND adopt the family identity: an individual leg market
      // already in the catalog (e.g. "Will Cristiano Ronaldo be the top goalscorer…")
      // becomes the event-level family ("World Cup: Golden Boot Winner") — otherwise
      // cross-venue candidate matching compares one leg's phrasing, not the family's.
      existing.question = entry.question
      existing.url = entry.url ?? existing.url
      existing.legs = entry.legs
      // Adopt the rep the fresh price belongs to (the old rep leg may have closed) —
      // marketId/closeDate/priceYes must stay a consistent set, else a future lock
      // would freeze one market's price and grade a different market.
      existing.marketId = entry.marketId
      existing.closeDate = entry.closeDate
      existing.priceYes = entry.priceYes
      existing.priceAsOf = entry.priceAsOf
      existing.category = 'World Cup'
      existing.marketCount = entry.marketCount
      existing.totalVolume = entry.totalVolume
      existing.volume = entry.volume
      // Preserve the targeted-keep provenance so the daily sweep can't evict it and
      // strip its legs/category mid-tournament.
      existing.scanLane = 'fast'
      existing.detectedAt = existing.detectedAt ?? entry.detectedAt
      refreshed++
    } else {
      catalog.push(entry)
      byHash.set(entry.rulebookHash, entry)
      added++
    }
    console.log(`  ${entry.question} — ${entry.marketCount} legs, $${Math.round(entry.totalVolume / 1e6)}M`)
  }

  // Kalshi: ingest open events under the configured WC series as family entries —
  // these carry tournament-wide volume but often miss the top-N sweep.
  for (const series of KALSHI_SERIES) {
    const j = await tryGetJson(`${KB}/events?series_ticker=${encodeURIComponent(series.trim())}&status=open&with_nested_markets=true&limit=200`)
    const events: any[] = j?.events ?? []
    for (const ev of events) {
      const ms: any[] = ev.markets || []
      const rep = [...ms].sort((a, b) => Number(b.volume_fp || 0) - Number(a.volume_fp || 0))[0]
      if (!rep?.ticker) continue
      try {
        const mi = await fetchKalshiMarket(rep.ticker)
        const hash = rulebookHash('Kalshi', mi.resolutionText)
        const legs = ms
          .map((m: any) => ({
            marketId: String(m.ticker || ''),
            label: String(m.yes_sub_title || m.title || ''),
            priceYes:
              Number(m.last_price_dollars) > 0 && Number(m.last_price_dollars) < 1 ? Number(m.last_price_dollars) : null,
            volume: Number(m.volume_fp || 0),
          }))
          .filter((l) => l.marketId && l.label)
        const totalVol = ms.reduce((s, m) => s + Number(m.volume_fp || 0), 0)
        const existing = byHash.get(hash)
        if (existing) {
          existing.legs = legs.length > 1 ? legs : existing.legs
          existing.category = 'World Cup'
          // Keep marketCount/volume in sync with the attached legs so the fan-out
          // guard sees a family, not a phantom 1×1 pair.
          existing.marketCount = Math.max(existing.marketCount, ms.length)
          existing.totalVolume = totalVol
          existing.volume = totalVol
          existing.scanLane = 'fast'
          existing.detectedAt = existing.detectedAt ?? new Date().toISOString()
          refreshed++
        } else {
          const entry: CatalogEntry = {
            platform: 'Kalshi',
            marketId: rep.ticker,
            rulebookHash: hash,
            question: ev.title || mi.question,
            category: 'World Cup',
            resolutionText: mi.resolutionText,
            resolutionSource: mi.resolutionSource ?? null,
            outcomes: mi.outcomes ?? ['Yes', 'No'],
            closeDate: mi.closeDate ?? null,
            volume: totalVol,
            marketCount: ms.length,
            totalVolume: totalVol,
            priceYes: null,
            priceAsOf: null,
            url: ev.series_ticker ? `https://kalshi.com/markets/${String(ev.series_ticker).toLowerCase()}` : null,
            fetchedAt: new Date().toISOString(),
            scanLane: 'fast',
            detectedAt: new Date().toISOString(),
            legs: legs.length > 1 ? legs : undefined,
          }
          catalog.push(entry)
          byHash.set(hash, entry)
          added++
        }
        console.log(`  Kalshi ${ev.title} — ${ms.length} legs, ${Math.round(totalVol / 1e6)}M contracts`)
      } catch {
        /* no usable rules — skip */
      }
    }
  }

  saveCatalog(catalog)
  appendPrices(catalog)

  // Score unscored WC families — budget-gated, one call per family.
  const scores = loadScores()
  const unscored = catalog.filter((e) => e.category === 'World Cup' && !scores[e.rulebookHash])
  if (unscored.length) {
    const cfg = getConfig()
    const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
    console.log(`\n  Scoring ${unscored.length} WC families (~$${(unscored.length * 0.05).toFixed(2)})…`)
    for (const e of unscored) {
      if (!budgetAllows().ok) {
        console.log('  budget exhausted — remaining families deferred.')
        break
      }
      try {
        const s = await scoreMarket(
          {
            platform: e.platform,
            marketId: e.marketId,
            question: e.question,
            resolutionText: e.resolutionText,
            resolutionSource: e.resolutionSource,
            closeDate: e.closeDate,
            outcomes: e.outcomes,
          },
          { client },
        )
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
          scanLane: 'fast',
          verdict: s.verdict,
        } satisfies CachedScore
        saveScores(scores)
        console.log(`   ${String(s.combined).padStart(3)}  ${e.question.slice(0, 56)}`)
      } catch (err) {
        console.log(`   err  ${e.question.slice(0, 50)} — ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  console.log(`\n  World Cup: +${added} families, ${refreshed} refreshed. ${spendSummary()}.\n`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
