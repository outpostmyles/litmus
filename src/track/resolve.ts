import { tryGetJson } from '../lib/http'
import type { Outcome } from './store'

// Shared settlement resolvers — extracted verbatim from settle-cli so the pair-leg
// grader uses the exact same finality rules and provenance strings as the main
// ledger. GRADING INTEGRITY: an outcome is returned only when the platform says the
// market is genuinely FINAL; ambiguous states stay pending (or surface as in-flight
// dispute evidence), never fabricated.

const KB = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2'
const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'

export interface Resolution {
  outcome: Outcome
  finalPriceYes: number | null
  /** How this outcome was derived — auditable provenance for every grade. */
  via: string
}

/** A resolution still in flight but visibly CONTESTED — recorded as evidence, not graded. */
export interface InFlight {
  inflight: true
  note: string
}

export type Probe = Resolution | InFlight | null

export function isInFlight(p: Probe): p is InFlight {
  return p != null && 'inflight' in p
}

export async function resolveKalshi(ticker: string): Promise<Probe> {
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

export async function resolvePolymarket(id: string): Promise<Probe> {
  let m: any = null
  if (/^\d+$/.test(id)) m = await tryGetJson(`${GAMMA}/markets/${id}`)
  if (!m) {
    const arr = await tryGetJson(`${GAMMA}/markets?slug=${encodeURIComponent(id)}`)
    const list = Array.isArray(arr) ? arr : arr?.data || []
    m = list?.[0] ?? null
  }
  if (!m || m.closed !== true) return null

  // UMA is Polymarket's resolution oracle. A live proposal/dispute is NOT final —
  // it is evidence of resolution risk, surfaced for recording.
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

  if (umaPending) return { inflight: true, note: `uma=${uma}` }
  if (pYes != null && pYes >= 0.99) {
    return { outcome: 'yes', finalPriceYes: pYes, via: `polymarket uma=${uma || 'n/a'} pYes=${pYes}` }
  }
  if (pNo != null && pNo >= 0.99) {
    return { outcome: 'no', finalPriceYes: pYes, via: `polymarket uma=${uma || 'n/a'} pYes=${pYes}` }
  }
  // Prices unconverged: only the oracle's explicit "resolved" makes this a real
  // (non-binary / split) outcome — otherwise stay pending rather than fabricate.
  if (umaFinal) {
    return { outcome: 'other', finalPriceYes: pYes, via: `polymarket uma=resolved unconverged pYes=${pYes ?? '—'}` }
  }
  return null
}
