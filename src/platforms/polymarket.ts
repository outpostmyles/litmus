import type { MarketInput } from '../engine/types'
import { getJson } from '../lib/http'

// Polymarket's Gamma API is public (no auth) and carries the full resolution text in `description`.
const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'

/** Accept a slug, numeric id, or a polymarket.com URL (last path segment is the slug). */
function extractSlug(input: string): string {
  let s = input.trim()
  if (s.startsWith('http')) {
    try {
      const u = new URL(s)
      s = u.pathname.split('/').filter(Boolean).pop() || s
    } catch {
      /* fall through */
    }
  }
  return s
}

function toMarketInput(m: any): MarketInput {
  let outcomes: string[] | undefined
  try {
    // Gamma returns `outcomes` as a JSON-encoded string.
    outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : Array.isArray(m.outcomes) ? m.outcomes : undefined
  } catch {
    /* leave undefined */
  }
  const mi: MarketInput = {
    platform: 'Polymarket',
    marketId: String(m.id ?? m.conditionId ?? m.slug ?? ''),
    question: m.question || m.slug || '',
    resolutionText: (m.description || '').trim(),
    resolutionSource: m.resolutionSource || null,
    closeDate: m.endDate || m.endDateIso || null,
    expectedResolutionDate: m.endDateIso || null,
    outcomes,
    volume: m.volumeNum != null ? Number(m.volumeNum) : m.volume != null ? Number(m.volume) : null,
    liquidity: m.liquidityNum != null ? Number(m.liquidityNum) : null,
    url: m.slug ? `https://polymarket.com/event/${m.slug}` : null,
  }
  if (!mi.resolutionText) throw new Error('Polymarket market has no description / resolution text.')
  return mi
}

/** Fetch a live Polymarket market by slug/id/URL and map it to the engine's input shape. */
export async function fetchPolymarketMarket(input: string): Promise<MarketInput> {
  const slug = extractSlug(input)

  if (/^\d+$/.test(slug)) {
    const m = await getJson(`${GAMMA}/markets/${slug}`)
    const market = Array.isArray(m) ? m[0] : m
    if (market) return toMarketInput(market)
  }

  const bySlug = await getJson(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`)
  let list: any[] = Array.isArray(bySlug) ? bySlug : bySlug?.data || []

  if (!list.length) {
    // The slug might be an event slug; fall back to its first market.
    const byEvent = await getJson(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`)
    const events: any[] = Array.isArray(byEvent) ? byEvent : byEvent?.data || []
    list = events[0]?.markets || []
  }

  if (!list.length) throw new Error(`Polymarket market not found for slug: ${slug}`)
  return toMarketInput(list[0])
}

function safeMap(list: any[], limit: number): MarketInput[] {
  const out: MarketInput[] = []
  for (const m of list) {
    if (out.length >= limit) break
    try {
      out.push(toMarketInput(m))
    } catch {
      /* skip markets with no usable resolution text */
    }
  }
  return out
}

/** List live Polymarket markets for the scan: top active by volume, optionally filtered. */
export async function listPolymarketMarkets(
  opts: { limit?: number; query?: string; event?: string } = {},
): Promise<MarketInput[]> {
  const limit = opts.limit ?? 12
  let raw: any[]
  if (opts.event) {
    const byEvent = await getJson(`${GAMMA}/events?slug=${encodeURIComponent(opts.event)}`)
    const events: any[] = Array.isArray(byEvent) ? byEvent : byEvent?.data || []
    raw = events[0]?.markets || []
  } else {
    // Gamma caps page size at 100 regardless of the requested limit — page for a real pool.
    raw = []
    for (let offset = 0; offset < 400; offset += 100) {
      const pool = await getJson(
        `${GAMMA}/markets?closed=false&active=true&order=volumeNum&ascending=false&limit=100&offset=${offset}`,
      )
      const rows: any[] = Array.isArray(pool) ? pool : pool?.data || []
      if (!rows.length) break
      raw.push(...rows)
      if (rows.length < 100) break
    }
  }

  let list = raw.filter(
    (m: any) => m && m.description && String(m.description).trim().length > 40 && m.question && m.closed !== true,
  )
  if (opts.query) {
    const q = opts.query.toLowerCase()
    list = list.filter(
      (m: any) => String(m.question).toLowerCase().includes(q) || String(m.description).toLowerCase().includes(q),
    )
  }
  // Dedup by question (events fan out into many near-identical markets).
  const seen = new Set<string>()
  const uniq: any[] = []
  for (const m of list) {
    const k = String(m.question).toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      uniq.push(m)
    }
  }
  uniq.sort((a: any, b: any) => Number(b.volumeNum || b.volume || 0) - Number(a.volumeNum || a.volume || 0))
  return safeMap(uniq, limit)
}
