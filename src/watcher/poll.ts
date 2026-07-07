import { getJson } from '../lib/http'

// Cheap listing polls. CRITICAL Polymarket detail: brand-new markets have ~zero
// volume, so the volume-ordered endpoints the rest of the pipeline uses will NEVER
// surface them — the watcher orders by id descending (newest first) instead.

const KB = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2'
const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'

export interface KalshiListing {
  eventTicker: string
  title: string
  category: string
  repTicker: string | null
  seriesTicker: string | null
  /** Number of markets under the event — >1 means a fan-out family (fan-out guard). */
  marketCount: number
}

export interface PolyListing {
  id: string
  raw: any
}

/** Current open Kalshi events (id = event_ticker). */
export async function pollKalshi(pages = Number(process.env.WATCHER_KALSHI_PAGES || '12')): Promise<KalshiListing[]> {
  const out: KalshiListing[] = []
  let cursor = ''
  for (let i = 0; i < pages; i++) {
    const j = await getJson(`${KB}/events?status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`)
    for (const e of j.events || []) {
      if (!e.series_ticker || /MVE|MULTIGAME/i.test(e.series_ticker)) continue
      const ms: any[] = e.markets || []
      const rep = [...ms].sort((a, b) => Number(b.volume_fp || 0) - Number(a.volume_fp || 0))[0]
      out.push({
        eventTicker: String(e.event_ticker),
        title: e.title || '',
        category: e.category || 'Other',
        repTicker: rep?.ticker ?? null,
        seriesTicker: e.series_ticker ?? null,
        marketCount: ms.length,
      })
    }
    cursor = j.cursor || ''
    if (!cursor) break
  }
  return out
}

/** Newest open Polymarket markets, id-descending (volume ordering misses new listings). */
export async function pollPolymarket(pages = Number(process.env.WATCHER_POLY_PAGES || '2')): Promise<PolyListing[]> {
  const out: PolyListing[] = []
  for (let i = 0; i < pages; i++) {
    const arr = await getJson(
      `${GAMMA}/markets?closed=false&active=true&order=id&ascending=false&limit=100&offset=${i * 100}`,
    )
    const rows: any[] = Array.isArray(arr) ? arr : arr?.data || []
    if (!rows.length) break
    for (const m of rows) {
      if (!m?.id || !m.description || String(m.description).trim().length <= 40) continue
      out.push({ id: String(m.id), raw: m })
    }
    if (rows.length < 100) break
  }
  return out
}
