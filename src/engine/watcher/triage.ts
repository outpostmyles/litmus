// Fast-scan triage: pure functions deciding what a NEW listing deserves.
// Not every new market is worth a push alert — most just flow to the Board
// with a "new" badge. Alert-worthy is deliberately narrow.

import { edgeTag, type LiteralFavors } from '../../../lib/litmus'

export interface TriageInput {
  /** Combined risk score, when the market was scored (cache hit or fresh). */
  combined: number | null
  band: string | null
  literalFavors?: LiteralFavors | null
  leanConfidence?: number | null
  leanCrowdConsistent?: boolean | null
  priceYes: number | null
  /** True when the market matched an existing cross-venue pair with divergence. */
  crossvenueDivergence?: boolean
}

export interface TriageDecision {
  alert: boolean
  reasons: string[]
}

/** Elevated band starts here — same constant as isFlagged/the backtest. */
const FLAG = 45

/**
 * Alert-worthy = flagged risk band, OR a qualifying edge (existing gates apply —
 * confidence, crowd-consistency, extreme-price rules all inherited from edgeTag),
 * OR a cross-venue divergence match. Everything else: Board with a "new" badge.
 */
export function triage(input: TriageInput): TriageDecision {
  const reasons: string[] = []
  if (input.combined != null && input.combined >= FLAG) {
    reasons.push(`risk ${input.combined} (elevated+)`)
  }
  const edge = edgeTag(input.literalFavors, input.priceYes, input.leanConfidence, input.leanCrowdConsistent)
  if (edge) reasons.push(`edge: ${edge.label}`)
  if (input.crossvenueDivergence) reasons.push('cross-venue divergence match')
  return { alert: reasons.length > 0, reasons }
}

/** IDs present now but not in the known set — the new listings. Pure. */
export function detectNew(knownIds: Set<string>, currentIds: string[]): string[] {
  return currentIds.filter((id) => !knownIds.has(id))
}
