import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../lib/env'
import { budgetAllows } from '../lib/spend'
import { rulebookHash, loadCatalog, saveCatalog, loadScores, saveScores, type CatalogEntry, type CachedScore } from '../cache/store'
import { appendPrices } from '../cache/prices'
import { scoreMarket } from '../engine/score'
import { fetchKalshiMarket } from '../platforms/kalshi'
import { loadTrack, saveTrack } from '../track/store'
import { lockPrediction } from '../track/lock'
import { triage, type TriageDecision } from '../engine/watcher/triage'
import { loadPairs } from '../cache/pairs-store'
import type { KalshiListing, PolyListing } from './poll'
import type { RecentListing } from '../engine/watcher/state'

// The fast-scan lane: a new listing goes from detection to scored-locked-triaged in
// one pass. Cache-first — many new listings reuse boilerplate rulebooks already
// scored (fan-out series, re-listed events), so the marginal cost is usually zero.
// Scoring respects the daily budget; locking and cataloging never do.

export interface FastScanResult extends RecentListing {
  combined?: number | null
}

function polyToCatalogEntry(m: any, detectedAt: string): CatalogEntry | null {
  const desc = String(m.description || '').trim()
  if (!desc) return null
  let outcomes: string[] = ['Yes', 'No']
  try {
    if (typeof m.outcomes === 'string') outcomes = JSON.parse(m.outcomes)
  } catch {
    /* default */
  }
  let priceYes: number | null = null
  try {
    const op = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices
    const p = Array.isArray(op) && op[0] != null ? Number(op[0]) : NaN
    if (p > 0 && p < 1) priceYes = p
  } catch {
    /* none */
  }
  return {
    platform: 'Polymarket',
    marketId: String(m.id),
    rulebookHash: rulebookHash('Polymarket', desc),
    question: m.question || m.slug || '',
    category: m.category || 'Other',
    resolutionText: desc,
    resolutionSource: m.resolutionSource ?? null,
    outcomes,
    closeDate: m.endDate || m.endDateIso || null,
    volume: Number(m.volumeNum || 0),
    marketCount: 1,
    totalVolume: Number(m.volumeNum || 0),
    priceYes,
    priceAsOf: new Date().toISOString(),
    url: m.slug ? `https://polymarket.com/event/${m.slug}` : null,
    fetchedAt: new Date().toISOString(),
    scanLane: 'fast',
    detectedAt,
  }
}

async function kalshiToCatalogEntry(l: KalshiListing, detectedAt: string): Promise<CatalogEntry | null> {
  if (!l.repTicker) return null
  const mi = await fetchKalshiMarket(l.repTicker) // throws when rules are empty (parlays)
  return {
    platform: 'Kalshi',
    marketId: l.repTicker,
    rulebookHash: rulebookHash('Kalshi', mi.resolutionText),
    question: l.title || mi.question,
    category: l.category,
    resolutionText: mi.resolutionText,
    resolutionSource: mi.resolutionSource ?? null,
    outcomes: mi.outcomes ?? ['Yes', 'No'],
    closeDate: mi.closeDate ?? null,
    volume: mi.volume ?? 0,
    marketCount: 1,
    totalVolume: mi.volume ?? 0,
    priceYes: null, // fetchKalshiMarket carries no price; brand-new books rarely have one
    priceAsOf: null,
    url: mi.url ?? null,
    fetchedAt: new Date().toISOString(),
    scanLane: 'fast',
    detectedAt,
  }
}

/**
 * Process one new listing end-to-end: catalog it, score it (cache-first, budget-
 * gated), lock the prediction, triage for alerting. Returns the audit record.
 */
export async function fastScan(
  listing: { venue: 'kalshi'; data: KalshiListing } | { venue: 'polymarket'; data: PolyListing },
  client?: Anthropic,
): Promise<FastScanResult> {
  const detectedAt = new Date().toISOString()
  const base: RecentListing = {
    venue: listing.venue,
    id: listing.venue === 'kalshi' ? listing.data.eventTicker : listing.data.id,
    question: '',
    detectedAt,
  }

  let entry: CatalogEntry | null = null
  try {
    entry =
      listing.venue === 'kalshi'
        ? await kalshiToCatalogEntry(listing.data, detectedAt)
        : polyToCatalogEntry(listing.data.raw, detectedAt)
  } catch {
    return { ...base, outcome: 'skipped' } // no usable rules text (parlays etc.)
  }
  if (!entry) return { ...base, outcome: 'skipped' }
  base.question = entry.question
  base.rulebookHash = entry.rulebookHash

  // Catalog merge (idempotent by hash) + price history point.
  const catalog = loadCatalog()
  if (!catalog.some((c) => c.rulebookHash === entry!.rulebookHash)) {
    catalog.push(entry)
    saveCatalog(catalog)
    appendPrices(catalog)
  }

  // Cache-first scoring; the budget gates only the PAID path. Ultra-short-horizon
  // listings (5-minute crypto up/downs etc.) are cataloged but never auto-scored —
  // a resolution trap needs time on the tape to matter, and templated micro-markets
  // would otherwise bleed the budget a nickel at a time.
  const MIN_HORIZON_H = Number(process.env.FASTSCAN_MIN_HORIZON_HOURS || '48')
  const horizonH = entry.closeDate ? (Date.parse(entry.closeDate) - Date.now()) / 3_600_000 : Infinity
  const scores = loadScores()
  let score: CachedScore | undefined = scores[entry.rulebookHash]
  let outcome: FastScanResult['outcome']
  if (score) {
    outcome = 'cache-hit'
  } else if (horizonH < MIN_HORIZON_H) {
    outcome = 'skipped'
  } else if (!budgetAllows().ok) {
    outcome = 'deferred' // next backfill picks it up; the listing is still cataloged
  } else {
    try {
      const s = await scoreMarket(
        {
          platform: entry.platform,
          marketId: entry.marketId,
          question: entry.question,
          resolutionText: entry.resolutionText,
          resolutionSource: entry.resolutionSource,
          closeDate: entry.closeDate,
          outcomes: entry.outcomes,
        },
        client ? { client } : {},
      )
      score = {
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
        detectedAt,
        verdict: s.verdict,
      }
      scores[entry.rulebookHash] = score
      saveScores(scores)
      outcome = 'scored'
    } catch {
      outcome = 'error'
    }
  }

  // Lock immediately — same invariants as the daily lane (shared implementation).
  if (score) {
    const track = loadTrack()
    if (lockPrediction(entry, score, track) === 'locked') saveTrack(track)
  }

  // Triage: does this deserve a push, or just a "new" badge on the Board?
  const pairs = loadPairs()
  const inPair = Object.values(pairs).some(
    (p) =>
      (p.kalshiHash === entry!.rulebookHash || p.polyHash === entry!.rulebookHash) &&
      (p.match?.same_event === 'yes' || p.match?.same_event === 'partial'),
  )
  const decision: TriageDecision = triage({
    combined: score?.combined ?? null,
    band: score?.band ?? null,
    literalFavors: score?.literalFavors ?? null,
    leanConfidence: score?.leanConfidence ?? null,
    leanCrowdConsistent: score?.leanCrowdConsistent ?? null,
    priceYes: entry.priceYes,
    crossvenueDivergence: inPair,
  })

  return { ...base, outcome, alert: decision.alert, reasons: decision.reasons, combined: score?.combined ?? null }
}

/** Shared client for a poll cycle (prompt cache stays warm across fresh scores). */
export function makeClient(): Anthropic {
  const cfg = getConfig()
  return new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
}
