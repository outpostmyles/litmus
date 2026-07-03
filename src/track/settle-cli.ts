import { loadTrack, saveTrack, type Outcome } from './store'
import { tryGetJson } from '../lib/http'

// Check open tracked markets for resolution and record the outcome. Free — read-only
// API calls. Run daily; it settles markets as they close.
//
// GRADING INTEGRITY: an entry is settled only when the platform says the market is
// genuinely FINAL. Anything ambiguous (UMA proposal pending, prices not converged,
// unknown status string) stays pending for the next run — mislabeling an unresolved
// market as "other" would count it as a surprise and pollute the calibration stats.
const KB = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2'
const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'
const CONCURRENCY = 5

interface Resolution {
  outcome: Outcome
  finalPriceYes: number | null
  /** How this outcome was derived — auditable provenance for every grade. */
  via: string
}

async function resolveKalshi(ticker: string): Promise<Resolution | null> {
  const j = await tryGetJson(`${KB}/markets/${encodeURIComponent(ticker)}`)
  const m = j?.market
  if (!m) return null
  const status = String(m.status || '').toLowerCase()
  if (!['settled', 'finalized', 'determined', 'resolved'].includes(status)) return null
  const result = String(m.result || '').toLowerCase()
  let outcome: Outcome
  if (result === 'yes') outcome = 'yes'
  else if (result === 'no') outcome = 'no'
  else if (result === 'void') outcome = 'void'
  else if (result === '') return null // status says settled but no result yet — wait for it
  else outcome = 'other'
  // The settlement VALUE is the honest final price; last trade is the fallback.
  const finalPriceYes =
    outcome === 'yes' ? 1 : outcome === 'no' ? 0 : m.last_price_dollars != null ? Number(m.last_price_dollars) : null
  return { outcome, finalPriceYes, via: `kalshi status=${status} result=${result}` }
}

async function resolvePolymarket(id: string): Promise<Resolution | null> {
  let m: any = null
  if (/^\d+$/.test(id)) m = await tryGetJson(`${GAMMA}/markets/${id}`)
  if (!m) {
    const arr = await tryGetJson(`${GAMMA}/markets?slug=${encodeURIComponent(id)}`)
    const list = Array.isArray(arr) ? arr : arr?.data || []
    m = list?.[0] ?? null
  }
  if (!m || m.closed !== true) return null

  // UMA is Polymarket's resolution oracle. If its status says a proposal/dispute is
  // still in flight, the market is NOT final — leave it pending. (A live UMA dispute
  // is itself the strongest possible confirmation of resolution risk, but we only
  // grade after it concludes.)
  const uma = String(m.umaResolutionStatus || '').toLowerCase()
  const umaFinal = uma === 'resolved'
  const umaPending = uma !== '' && !umaFinal

  let prices: number[] | null = null
  try {
    const op = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices
    if (Array.isArray(op)) prices = op.map(Number)
  } catch {
    /* no prices */
  }
  const pYes = prices && prices.length >= 2 ? (prices[0] ?? null) : null
  const pNo = prices && prices.length >= 2 ? (prices[1] ?? null) : null

  if (umaPending) return null
  if (pYes != null && pYes >= 0.99) {
    return { outcome: 'yes', finalPriceYes: pYes, via: `polymarket uma=${uma || 'n/a'} pYes=${pYes}` }
  }
  if (pNo != null && pNo >= 0.99) {
    return { outcome: 'no', finalPriceYes: pYes, via: `polymarket uma=${uma || 'n/a'} pYes=${pYes}` }
  }
  // Prices not converged: only the oracle's explicit "resolved" makes this a real
  // (non-binary / split) outcome. Without it, we can't tell "settled weird" from
  // "still in flight" — stay pending rather than fabricate a surprise.
  if (umaFinal) {
    return { outcome: 'other', finalPriceYes: pYes, via: `polymarket uma=resolved unconverged pYes=${pYes ?? '—'}` }
  }
  return null
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
      t.resolvedVia = res.via
      saveTrack(track)
      settled++
      console.log(`  ${res.outcome.toUpperCase().padEnd(5)} ${e.question.slice(0, 56)}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()))

  const totalResolved = Object.values(track).filter((e) => e.settled).length
  console.log(`\n  Settled ${settled} this run. ${totalResolved} resolved total.`)

  // Visibility on entries the resolver can't finalize (delisted market, oracle limbo):
  // they stay conservatively pending, but silence would let them pile up unnoticed.
  const STUCK_DAYS = 30
  const stuck = Object.values(track).filter(
    (e) => !e.settled && e.closeDate && Date.now() - Date.parse(e.closeDate) > STUCK_DAYS * 86_400_000,
  )
  if (stuck.length) {
    console.log(`  ${stuck.length} entr${stuck.length === 1 ? 'y' : 'ies'} still pending >${STUCK_DAYS}d past close — inspect manually:`)
    for (const e of stuck.slice(0, 5)) console.log(`     ${e.platform} ${e.marketId}  ${e.question.slice(0, 48)}`)
  }
  console.log('')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
