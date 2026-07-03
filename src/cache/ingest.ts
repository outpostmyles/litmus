import { rulebookHash, type CatalogEntry } from './store'
import { fetchKalshiMarket } from '../platforms/kalshi'
import { getJson } from '../lib/http'

const KB = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2'
const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'

/** Merge catalog entries that share a rulebook (sum volume, keep highest-volume representative). */
function dedupeByHash(entries: CatalogEntry[]): CatalogEntry[] {
  const byHash = new Map<string, CatalogEntry>()
  for (const e of entries) {
    const g = byHash.get(e.rulebookHash)
    if (!g) {
      byHash.set(e.rulebookHash, { ...e })
    } else {
      g.totalVolume += e.totalVolume
      g.marketCount += e.marketCount
      if (e.volume > g.volume) {
        // promote the bigger market to representative, but keep the merged aggregates
        const total = g.totalVolume
        const count = g.marketCount
        byHash.set(e.rulebookHash, { ...e, totalVolume: total, marketCount: count })
      }
    }
  }
  return [...byHash.values()]
}

/** Pull high-volume Kalshi events (one representative per event — markets in an event share a rulebook). */
export async function ingestKalshi(minContracts: number, max: number): Promise<CatalogEntry[]> {
  let cursor = ''
  const events: any[] = []
  let pages = 0
  do {
    const j = await getJson(`${KB}/events?status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`)
    events.push(...(j.events || []))
    cursor = j.cursor || ''
    pages++
  } while (cursor && pages < 12)

  const qualifying = events
    .filter((e) => e.series_ticker && !/MVE|MULTIGAME/i.test(e.series_ticker))
    .map((e) => {
      const ms: any[] = e.markets || []
      const totalVol = ms.reduce((s, m) => s + Number(m.volume_fp || 0), 0)
      const rep = [...ms].sort((a, b) => Number(b.volume_fp || 0) - Number(a.volume_fp || 0))[0]
      return { event: e, totalVol, rep, count: ms.length }
    })
    .filter((x) => x.rep && x.totalVol >= minContracts)
    .sort((a, b) => b.totalVol - a.totalVol)
    .slice(0, max)

  const out: CatalogEntry[] = []
  for (const q of qualifying) {
    try {
      const mi = await fetchKalshiMarket(q.rep.ticker)
      out.push({
        platform: 'Kalshi',
        // The representative market ticker (resolvable via GET /markets/{ticker}); event ticker is the fallback.
        marketId: q.rep.ticker || q.event.event_ticker,
        rulebookHash: rulebookHash('Kalshi', mi.resolutionText),
        question: q.event.title || mi.question,
        category: q.event.category || 'Other',
        resolutionText: mi.resolutionText,
        resolutionSource: mi.resolutionSource ?? null,
        outcomes: mi.outcomes ?? ['Yes', 'No'],
        closeDate: mi.closeDate ?? null,
        volume: q.totalVol,
        marketCount: q.count,
        totalVolume: q.totalVol,
        priceYes:
          Number(q.rep.last_price_dollars) > 0 && Number(q.rep.last_price_dollars) < 1
            ? Number(q.rep.last_price_dollars)
            : null,
        priceAsOf: new Date().toISOString(),
        // Series landing page — the canonical public URL for an event's markets.
        url: q.event.series_ticker ? `https://kalshi.com/markets/${String(q.event.series_ticker).toLowerCase()}` : null,
        fetchedAt: new Date().toISOString(),
      })
    } catch {
      /* skip markets whose rules text is empty / unavailable */
    }
  }
  return dedupeByHash(out)
}

/** Pull high-volume Polymarket markets, grouped by rulebook (fan-outs collapse to one entry). */
export async function ingestPolymarket(minVolume: number, max: number): Promise<CatalogEntry[]> {
  // Page through Gamma in volume order until results fall below the volume floor —
  // a single un-paginated call silently capped the universe at its first page.
  // Gamma caps page size at 100 regardless of the requested limit, so advance the
  // offset by what actually arrived and only treat an EMPTY page as the end.
  const PAGE = 100
  const MAX_ROWS = 1500
  const list: any[] = []
  const seenIds = new Set<string>()
  let offset = 0
  while (offset < MAX_ROWS) {
    const arr = await getJson(
      `${GAMMA}/markets?closed=false&active=true&order=volumeNum&ascending=false&limit=${PAGE}&offset=${offset}`,
    )
    const rows: any[] = Array.isArray(arr) ? arr : arr?.data || []
    if (!rows.length) break // true last page
    offset += rows.length
    for (const m of rows) {
      const id = String(m?.id ?? '')
      if (id && seenIds.has(id)) continue // guard against re-ordering drift between requests
      if (id) seenIds.add(id)
      list.push(m)
    }
    const tailVol = Number(rows[rows.length - 1]?.volumeNum || 0)
    if (tailVol < minVolume) break // volume-ordered: everything deeper is below the floor
  }
  const qualifying = list.filter(
    (m) => m && m.description && String(m.description).trim().length > 40 && Number(m.volumeNum || 0) >= minVolume,
  )

  const groups = new Map<string, { rep: any; total: number; count: number }>()
  for (const m of qualifying) {
    const h = rulebookHash('Polymarket', String(m.description))
    const vol = Number(m.volumeNum || m.volume || 0)
    const g = groups.get(h)
    if (!g) groups.set(h, { rep: m, total: vol, count: 1 })
    else {
      g.total += vol
      g.count += 1
      if (vol > Number(g.rep.volumeNum || 0)) g.rep = m
    }
  }

  const out: CatalogEntry[] = []
  for (const [h, g] of groups) {
    const m = g.rep
    let outcomes: string[] = ['Yes', 'No']
    try {
      if (typeof m.outcomes === 'string') outcomes = JSON.parse(m.outcomes)
    } catch {
      /* keep default */
    }
    let priceYes: number | null = null
    try {
      const op = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices
      if (Array.isArray(op) && op[0] != null) {
        const p = Number(op[0])
        if (p > 0 && p < 1) priceYes = p
      }
    } catch {
      /* no price */
    }
    out.push({
      platform: 'Polymarket',
      marketId: String(m.id ?? m.slug ?? ''),
      rulebookHash: h,
      question: m.question || m.slug || '',
      category: m.category || 'Other',
      resolutionText: String(m.description).trim(),
      resolutionSource: m.resolutionSource ?? null,
      outcomes,
      closeDate: m.endDate || m.endDateIso || null,
      volume: g.total,
      marketCount: g.count,
      totalVolume: g.total,
      priceYes,
      priceAsOf: new Date().toISOString(),
      url: m.slug ? `https://polymarket.com/event/${m.slug}` : null,
      fetchedAt: new Date().toISOString(),
    })
  }
  return out.sort((a, b) => b.totalVolume - a.totalVolume).slice(0, max)
}
