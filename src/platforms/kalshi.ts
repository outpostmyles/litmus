import type { MarketInput } from '../engine/types'

// Kalshi's market-data reads are fully public — no auth, no signing.
const KALSHI_BASE = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2'

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Kalshi API returned ${res.status} for ${url}`)
  return res.json()
}

/** Accept a bare ticker or a Kalshi URL (#TICKER fragment or last path segment). */
function extractTicker(input: string): string {
  let s = input.trim()
  if (s.startsWith('http')) {
    try {
      const u = new URL(s)
      s = u.hash ? u.hash.replace(/^#/, '') : u.pathname.split('/').filter(Boolean).pop() || s
    } catch {
      /* fall through */
    }
  }
  return s.toUpperCase()
}

/** Fetch a live Kalshi market by ticker/URL and map it to the engine's input shape. */
export async function fetchKalshiMarket(input: string): Promise<MarketInput> {
  const ticker = extractTicker(input)
  const { market } = await getJson(`${KALSHI_BASE}/markets/${encodeURIComponent(ticker)}`)
  if (!market) throw new Error(`Kalshi market not found: ${ticker}`)

  // Long-form rules live on the market; the named settlement source lives on the parent event.
  let eventTitle = ''
  let settlementSources = ''
  if (market.event_ticker) {
    try {
      const { event } = await getJson(`${KALSHI_BASE}/events/${encodeURIComponent(market.event_ticker)}`)
      eventTitle = event?.title || ''
      settlementSources = (event?.settlement_sources || [])
        .map((x: any) => x?.name)
        .filter(Boolean)
        .join(', ')
    } catch {
      /* event lookup is best-effort */
    }
  }

  const rules = [market.rules_primary, market.rules_secondary]
    .filter((x) => x && String(x).trim())
    .join('\n\n')
    .trim()
  if (!rules) {
    throw new Error(`Kalshi market ${ticker} returned no rules text (rules_primary/rules_secondary empty).`)
  }

  const question =
    [eventTitle, market.yes_sub_title || market.title].filter(Boolean).join(' — ') || market.ticker

  return {
    platform: 'Kalshi',
    marketId: market.ticker,
    question,
    resolutionText: rules,
    resolutionSource: settlementSources || null,
    closeDate: market.close_time || null,
    expectedResolutionDate: market.expected_expiration_time || null,
    outcomes: ['Yes', 'No'],
    volume: market.volume_fp != null ? Number(market.volume_fp) : null,
    liquidity: null, // liquidity_dollars is deprecated on Kalshi and always 0
  }
}

/**
 * List live Kalshi markets for the scan: one representative market per open event
 * (skipping the auto-generated multi-game parlay series), highest-volume first.
 * Single-fetches in volume order until `limit` markets with real rules text are found.
 */
export async function listKalshiMarkets(opts: { category?: string; limit?: number } = {}): Promise<MarketInput[]> {
  const limit = opts.limit ?? 12
  const ej = await getJson(`${KALSHI_BASE}/events?status=open&with_nested_markets=true&limit=200`)
  let events: any[] = (ej.events || []).filter((e: any) => e.series_ticker && !/MVE|MULTIGAME/i.test(e.series_ticker))
  if (opts.category) {
    const c = opts.category.toLowerCase()
    events = events.filter((e: any) => String(e.category || '').toLowerCase() === c)
  }

  const reps: { ticker: string; volume: number }[] = []
  for (const e of events) {
    const ms: any[] = e.markets || []
    const m = ms.find((x: any) => x.status === 'active') || ms[0]
    if (m && m.ticker) reps.push({ ticker: m.ticker, volume: m.volume_fp != null ? Number(m.volume_fp) : 0 })
  }
  reps.sort((a, b) => b.volume - a.volume)

  const out: MarketInput[] = []
  for (const r of reps) {
    if (out.length >= limit) break
    try {
      out.push(await fetchKalshiMarket(r.ticker))
    } catch {
      /* skip markets whose rules text is empty (parlays / structured) */
    }
  }
  return out
}
