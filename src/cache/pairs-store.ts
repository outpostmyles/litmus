import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MatchResult } from '../engine/crossvenue/matchConfirm'
import type { DivergenceResult } from '../engine/crossvenue/divergenceScore'

// Cross-venue pair cache. Keyed by the pair of rulebook hashes so no pair is ever
// paid for twice — the same never-pay-twice pattern as scores.json. Records are
// append/update only; a pair whose markets left the catalog keeps its paid analysis.
export const PAIRS_PATH = 'data/cache/pairs.json'
/** Cross-process run lock shared by crossvenue + pairs-settle (last-writer-wins stores). */
export const CROSSVENUE_LOCK = 'data/cache/.crossvenue.lock'

export function pairKey(kalshiHash: string, polyHash: string): string {
  return `${kalshiHash}:${polyHash}`
}

export interface PairRecord {
  pairKey: string
  kalshiHash: string
  polyHash: string
  /** Stage-1 structured-signal score at discovery time. */
  candidateScore: number
  discoveredAt: string
  /** Stage 2 (cached LLM): same-event confirmation. */
  match?: MatchResult & { model: string; checkedAt: string }
  /** Stage 3 (cached LLM): rule divergence. Only for same_event yes/partial. */
  divergence?: DivergenceResult & { model: string; scoredAt: string }
  /** True while both rulebooks are present in the current catalog. */
  active: boolean
}

export type Pairs = Record<string, PairRecord>

export function loadPairs(): Pairs {
  if (!existsSync(PAIRS_PATH)) return {}
  // A corrupt cache must fail LOUDLY — silently returning {} would break the
  // never-pay-twice guarantee and re-bill every cached pair on the next run.
  return JSON.parse(readFileSync(PAIRS_PATH, 'utf8')) as Pairs
}

export function savePairs(p: Pairs): void {
  mkdirSync(dirname(PAIRS_PATH), { recursive: true })
  // Atomic write (tmp + rename): this file is the paid cache, saved after every
  // model call — a crash mid-write must never truncate it.
  const tmp = `${PAIRS_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(p, null, 2))
  renameSync(tmp, PAIRS_PATH)
}
