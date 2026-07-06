import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadTrack, type Track } from './store'

// Pair ledger: the cross-venue forward record. A pair is LOCKED while both legs are
// still open — divergence score, both entry prices, and the gap are frozen at lock —
// and graded only when both legs settle, from the same provenance-carrying outcomes
// the main ledger records. A locked pair is never rewritten (reconciliation notes are
// additive annotations, not edits). A confirmed SPLIT settlement — the SAME event
// settled opposite ways by the two venues — is the single most valuable validation
// artifact this product can produce; it is captured here with full provenance.
export const PAIR_TRACK_PATH = 'data/cache/pairtrack.json'

export interface PairLeg {
  platform: 'Kalshi' | 'Polymarket'
  hash: string
  marketId: string
  question: string
  closeDate: string | null
  priceYesAtLock: number | null
  /**
   * Fan-out size of the leg's rulebook group at lock. Only 1×1 pairs are honestly
   * gradeable — a group's outcome is its representative market's outcome, and
   * comparing two arbitrary representatives (e.g. one candidate leg vs another)
   * says nothing about venue agreement.
   */
  marketCount: number
}

export interface PairLedgerEntry {
  pairKey: string
  lockedAt: string
  kalshi: PairLeg
  poly: PairLeg
  /** Divergence + same-event verdict frozen at lock time. */
  sameEvent: 'yes' | 'partial'
  divergenceBase: number
  gapAtLock: number | null
  scenarioThatSplits: string | null
  // --- reconciliation (additive annotations; locked fields above are never edited) ---
  /** Set when a later re-confirmation disagrees with the locked sameEvent verdict. */
  verdictNow?: 'yes' | 'partial' | 'no'
  verdictSupersededAt?: string
  // --- grading (filled when BOTH legs settle) ---
  settled: boolean
  settledAt?: string
  kalshiOutcome?: string
  polyOutcome?: string
  kalshiResolvedVia?: string
  polyResolvedVia?: string
  /**
   * 'identical'         — both venues settled the same way (yes/yes or no/no)
   * 'split'             — SAME EVENT (sameEvent='yes', verdict unsuperseded, 1×1
   *                       legs), OPPOSITE settlements. The money artifact.
   * 'divergent-partial' — opposite settlements on a PARTIAL pair: expected when the
   *                       questions differ; evidence of the trap, not a split receipt.
   * 'non-comparable'    — void/other on either leg, fan-out legs, or a superseded
   *                       same-event verdict; no honest comparison exists.
   */
  settlement?: 'identical' | 'split' | 'divergent-partial' | 'non-comparable'
}

export type PairTrack = Record<string, PairLedgerEntry>

export function loadPairTrack(): PairTrack {
  if (!existsSync(PAIR_TRACK_PATH)) return {}
  // A corrupt ledger must fail LOUDLY — silently starting fresh would orphan every
  // locked pair and let re-locks rewrite history.
  return JSON.parse(readFileSync(PAIR_TRACK_PATH, 'utf8')) as PairTrack
}

export function savePairTrack(t: PairTrack): void {
  mkdirSync(dirname(PAIR_TRACK_PATH), { recursive: true })
  const tmp = `${PAIR_TRACK_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(t, null, 2))
  renameSync(tmp, PAIR_TRACK_PATH)
}

/**
 * Grade pending pair entries from the main ledger's settled outcomes. Free and
 * idempotent — reads track.json (whose outcomes already carry resolvedVia
 * provenance), writes only the grading fields of unsettled pair entries.
 */
export function gradePairs(pairTrack: PairTrack, track: Track = loadTrack()): { graded: number; splits: number } {
  let graded = 0
  let splits = 0
  for (const p of Object.values(pairTrack)) {
    if (p.settled) continue
    const k = track[p.kalshi.hash]
    const m = track[p.poly.hash]
    if (!k?.settled || !m?.settled || !k.outcome || !m.outcome) continue
    p.settled = true
    p.settledAt = new Date().toISOString()
    p.kalshiOutcome = k.outcome
    p.polyOutcome = m.outcome
    p.kalshiResolvedVia = k.resolvedVia
    p.polyResolvedVia = m.resolvedVia
    const comparable = (o: string) => o === 'yes' || o === 'no'
    const fanOut = (p.kalshi.marketCount ?? 1) > 1 || (p.poly.marketCount ?? 1) > 1
    if (!comparable(k.outcome) || !comparable(m.outcome) || fanOut) {
      p.settlement = 'non-comparable'
    } else if (k.outcome === m.outcome) {
      p.settlement = 'identical'
    } else if (p.sameEvent === 'yes' && !p.verdictNow) {
      // Opposite outcomes on a confirmed, unsuperseded same-event 1×1 pair: a split.
      p.settlement = 'split'
      splits++
    } else {
      // Opposite outcomes on a partial (or verdict-superseded) pair are the expected
      // consequence of asking different questions — a trap caught, not a receipt.
      p.settlement = 'divergent-partial'
    }
    graded++
  }
  return { graded, splits }
}
