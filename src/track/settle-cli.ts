import { loadTrack, saveTrack, type Outcome } from './store'

// Check open tracked markets for resolution and record the outcome. Free — read-only
// API calls. Run daily; it settles markets as they close.
const KB = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2'
const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'
const CONCURRENCY = 5

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

interface Resolution {
  outcome: Outcome
  finalPriceYes: number | null
}

async function resolveKalshi(ticker: string): Promise<Resolution | null> {
  const j = await getJson(`${KB}/markets/${encodeURIComponent(ticker)}`)
  const m = j?.market
  if (!m) return null
  const status = String(m.status || '').toLowerCase()
  if (!['settled', 'finalized', 'determined', 'resolved'].includes(status)) return null
  const result = String(m.result || '').toLowerCase()
  const finalPriceYes = m.last_price_dollars != null ? Number(m.last_price_dollars) : null
  let outcome: Outcome
  if (result === 'yes') outcome = 'yes'
  else if (result === 'no') outcome = 'no'
  else if (result === 'void') outcome = 'void'
  else outcome = 'other'
  return { outcome, finalPriceYes }
}

async function resolvePolymarket(id: string): Promise<Resolution | null> {
  let m: any = null
  if (/^\d+$/.test(id)) m = await getJson(`${GAMMA}/markets/${id}`)
  if (!m) {
    const arr = await getJson(`${GAMMA}/markets?slug=${encodeURIComponent(id)}`)
    const list = Array.isArray(arr) ? arr : arr?.data || []
    m = list?.[0] ?? null
  }
  if (!m || m.closed !== true) return null
  let prices: number[] | null = null
  try {
    const op = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices
    if (Array.isArray(op)) prices = op.map(Number)
  } catch {
    /* no prices */
  }
  if (!prices || prices.length < 2) return null
  const pYes = prices[0]
  const pNo = prices[1]
  let outcome: Outcome
  if (pYes != null && pYes >= 0.99) outcome = 'yes'
  else if (pNo != null && pNo >= 0.99) outcome = 'no'
  else outcome = 'other'
  return { outcome, finalPriceYes: pYes ?? null }
}

async function main(): Promise<void> {
  const track = loadTrack()
  const pending = Object.values(track).filter((e) => !e.settled)
  if (!pending.length) {
    console.log('\n  Nothing to settle — no open tracked markets.\n')
    return
  }
  console.log(`\n  Checking ${pending.length} open tracked markets for resolution…\n`)

  let next = 0
  let settled = 0
  async function worker(): Promise<void> {
    while (next < pending.length) {
      const e = pending[next++]!
      const res = e.platform === 'Kalshi' ? await resolveKalshi(e.marketId) : await resolvePolymarket(e.marketId)
      if (!res) continue
      const t = track[e.hash]
      if (!t) continue
      t.settled = true
      t.outcome = res.outcome
      t.finalPriceYes = res.finalPriceYes
      t.resolvedAt = new Date().toISOString()
      saveTrack(track)
      settled++
      console.log(`  ${res.outcome.toUpperCase().padEnd(5)} ${e.question.slice(0, 56)}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()))

  const totalResolved = Object.values(track).filter((e) => e.settled).length
  console.log(`\n  Settled ${settled} this run. ${totalResolved} resolved total.\n`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
