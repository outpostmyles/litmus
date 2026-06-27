export const DIMENSIONS = [
  'source_clarity',
  'criteria_precision',
  'literal_vs_intuitive',
  'timing',
  'dispute_surface',
] as const

export type Dimension = (typeof DIMENSIONS)[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  source_clarity: 'Source clarity',
  criteria_precision: 'Criteria precision',
  literal_vs_intuitive: 'Literal-vs-intuitive gap',
  timing: 'Timing risk',
  dispute_surface: 'Dispute surface',
}

/**
 * Dimension weights for the combined score. Source clarity and the
 * literal-vs-intuitive gap carry the most weight: a missing source of truth is
 * the single biggest red flag, and the literal-vs-intuitive gap is where the
 * money is made and lost. Weights sum to 1.
 */
export const WEIGHTS: Record<Dimension, number> = {
  source_clarity: 0.25,
  criteria_precision: 0.2,
  literal_vs_intuitive: 0.25,
  timing: 0.12,
  dispute_surface: 0.18,
}

/**
 * How much the single worst dimension pulls the combined score, on top of the
 * weighted average. One fatal clause can blow up a market even when every other
 * dimension is clean, so a pure average would understate it — but a pure max
 * would be too noisy. 0.30 blends both.
 */
export const WORST_BLEND = 0.3

export type RiskBand = 'low' | 'moderate' | 'elevated' | 'high' | 'severe'

/** Combine per-dimension scores into a single 0–100 resolution-risk score. */
export function combineScore(scores: Record<Dimension, number>): number {
  const weightedAvg = DIMENSIONS.reduce((sum, d) => sum + scores[d] * WEIGHTS[d], 0)
  const worst = Math.max(...DIMENSIONS.map((d) => scores[d]))
  return Math.round((1 - WORST_BLEND) * weightedAvg + WORST_BLEND * worst)
}

export function riskBand(combined: number): RiskBand {
  if (combined < 25) return 'low'
  if (combined < 45) return 'moderate'
  if (combined < 65) return 'elevated'
  if (combined < 85) return 'high'
  return 'severe'
}
