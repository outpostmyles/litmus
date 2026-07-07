import type { CatalogEntry, CachedScore } from '../cache/store'
import { edgeTag, STALE_HOURS } from '../../lib/litmus'
import type { Track } from './store'

// THE single implementation of prediction-locking. Both lanes (daily snapshot and
// fast-scan) call this, so the invariants live in exactly one place:
//  - never overwrite an existing entry (entry price stays fixed → no double-lock)
//  - never lock an already-closed market (look-ahead)
//  - never lock at a stale cached price (phantom dislocation)
//  - never lock an unverifiably-open market at a near-decided price (look-ahead)

export type LockResult = 'locked' | 'already-tracked' | 'closed' | 'stale-price' | 'unverifiable' | 'unscored'

/** Prices this extreme mean the event is effectively decided — a "free win" if graded. */
const DECIDED_LOW = 0.02
const DECIDED_HIGH = 0.98

export function lockPrediction(
  e: CatalogEntry,
  s: CachedScore | undefined,
  track: Track,
  now = Date.now(),
): LockResult {
  if (!s) return 'unscored'
  if (track[e.rulebookHash]) return 'already-tracked'

  if (e.closeDate) {
    const t = Date.parse(e.closeDate)
    if (Number.isFinite(t) && t <= now) return 'closed'
  } else if (e.priceYes != null && (e.priceYes <= DECIDED_LOW || e.priceYes >= DECIDED_HIGH)) {
    // No close date to verify the market is still open, AND the price says it's already
    // decided → locking it would book a look-ahead "free win" into the calibration.
    return 'unverifiable'
  }

  const priceAgeH = e.priceAsOf ? (now - Date.parse(e.priceAsOf)) / 3_600_000 : null
  if (e.priceYes != null && priceAgeH != null && priceAgeH > STALE_HOURS) return 'stale-price'

  const edge = edgeTag(s.literalFavors, e.priceYes, s.leanConfidence, s.leanCrowdConsistent)
  // A fan-out family locks via its REPRESENTATIVE market — the row must say which
  // leg is actually being graded ("World Cup Winner — France"), not wear the family
  // title over one leg's outcome.
  const repLeg = e.legs?.find((l) => l.marketId === e.marketId)
  const question = repLeg ? `${e.question} — ${repLeg.label}` : e.question
  track[e.rulebookHash] = {
    hash: e.rulebookHash,
    platform: e.platform,
    marketId: e.marketId,
    question,
    closeDate: e.closeDate,
    snapshotAt: new Date(now).toISOString(),
    combined: s.combined,
    band: s.band,
    headlineRisk: s.headlineRisk,
    edgeSide: edge ? edge.side : null,
    entryPriceYes: e.priceYes ?? null,
    settled: false,
    edgeVersion: 3,
    scanLane: e.scanLane ?? s.scanLane ?? 'daily',
    detectedAt: e.detectedAt ?? s.detectedAt,
  }
  return 'locked'
}
