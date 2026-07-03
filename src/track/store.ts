import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// Local track-record store. Each entry locks a PREDICTION at first sight (snapshot)
// and is filled with the RESOLUTION when the market settles. Grading is derived.
export const TRACK_PATH = 'data/cache/track.json'

export type Outcome = 'yes' | 'no' | 'other' | 'void'

export interface TrackEntry {
  hash: string
  platform: string
  marketId: string
  question: string
  closeDate: string | null
  // --- prediction (locked at snapshot) ---
  snapshotAt: string
  combined: number
  band: string
  headlineRisk: string
  /** The rules-favored side if this was an edge at snapshot time, else null. */
  edgeSide: 'yes' | 'no' | null
  /** Implied Yes price when we locked the prediction = our paper-trade entry. */
  entryPriceYes: number | null
  // --- resolution (filled by settle) ---
  settled: boolean
  resolvedAt?: string
  outcome?: Outcome
  finalPriceYes?: number | null
  /** How the outcome was derived from the platform API — audit trail for every grade. */
  resolvedVia?: string
  /**
   * Evidence that resolution went sideways IN FLIGHT (e.g. "uma=disputed 2026-07-03"),
   * recorded the first time settle observes it. Persists after final settlement — a
   * market that was disputed and then resolved is exactly what this tool predicts.
   */
  disputeSeen?: string
  /** Which edge-rule generation locked this prediction (3 = confidence+crowd-gated). */
  edgeVersion?: number
}

export type Track = Record<string, TrackEntry>

function read(): Track {
  try {
    return JSON.parse(readFileSync(TRACK_PATH, 'utf8')) as Track
  } catch {
    return {}
  }
}
function write(t: Track): void {
  mkdirSync(dirname(TRACK_PATH), { recursive: true })
  writeFileSync(TRACK_PATH, JSON.stringify(t, null, 2))
}
export function loadTrack(): Track {
  return read()
}
export function saveTrack(t: Track): void {
  write(t)
}

// --- grading -------------------------------------------------------------

/** A market is "flagged" by the risk score at elevated band or higher. */
export function isFlagged(e: TrackEntry): boolean {
  return e.combined >= 45
}

export type Surprise = 'surprise' | 'clean' | 'tossup'

/**
 * Did the market resolve differently than the crowd's confident price implied?
 * other/void resolutions count as surprises; ~50/50 prices are tossups (excluded).
 *
 * Calibration is judged against the price we LOCKED at snapshot (entryPriceYes) — never
 * the final price. Falling back to finalPriceYes would be look-ahead: it would grade the
 * "surprise" against a price that already knew the outcome. No entry price → ungradeable.
 */
export function classifySurprise(e: TrackEntry): Surprise | null {
  if (!e.settled || !e.outcome) return null
  if (e.outcome === 'other' || e.outcome === 'void') return 'surprise'
  const p = e.entryPriceYes
  if (p == null) return null
  if (p > 0.35 && p < 0.65) return 'tossup'
  if (e.outcome === 'yes') return p <= 0.35 ? 'surprise' : 'clean'
  return p >= 0.65 ? 'surprise' : 'clean' // outcome === 'no'
}

export interface EdgeResult {
  result: 'win' | 'loss' | 'push'
  /** P&L on a 1-unit paper trade on the rules-favored side, entered at snapshot price. */
  pnl: number
}

/**
 * PROCESS outcome — did the RESOLUTION go sideways, regardless of which side won?
 * This is the tool's actual claim ("settlement goes wrong"), so it's the primary
 * calibration target; a price-flip surprise is the secondary, rarer one.
 *
 *  - contested: a dispute was observed in flight, or the platform settled to "other"
 *  - void:      the market voided
 *  - split:     the oracle finalized without price convergence (non-binary/split result)
 *  - delayed:   settled >7d after close (buffered for our daily polling cadence)
 *  - clean:     none of the above
 */
export type ProcessOutcome = 'clean' | 'delayed' | 'contested' | 'split' | 'void'

export function processOutcome(e: TrackEntry): ProcessOutcome | null {
  if (!e.settled) return null
  if (e.outcome === 'void') return 'void'
  if (e.disputeSeen || e.outcome === 'other') return 'contested'
  if (e.resolvedVia?.includes('unconverged')) return 'split'
  if (e.closeDate && e.resolvedAt) {
    const lagDays = (Date.parse(e.resolvedAt) - Date.parse(e.closeDate)) / 86_400_000
    if (Number.isFinite(lagDays) && lagDays > 7) return 'delayed'
  }
  return 'clean'
}

export function edgeResult(e: TrackEntry): EdgeResult | null {
  if (!e.edgeSide || !e.settled || !e.outcome) return null
  const p = e.entryPriceYes
  if (p == null) return null
  if (e.outcome === 'other' || e.outcome === 'void') return { result: 'push', pnl: 0 }
  const won = e.outcome === e.edgeSide
  if (e.edgeSide === 'yes') return { result: won ? 'win' : 'loss', pnl: won ? 1 - p : -p }
  // edgeSide === 'no' → entry cost is the No price (1 - p)
  return { result: won ? 'win' : 'loss', pnl: won ? p : -(1 - p) }
}
