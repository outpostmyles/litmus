// Shared client/server helpers. The "litmus" idea: the whole UI takes its color
// from the risk score, like an indicator strip changing color in a test.

export type RiskBand = 'low' | 'moderate' | 'elevated' | 'high' | 'severe'

export interface DimensionResult {
  key: string
  label: string
  score: number
  weight: number
  reasoning: string
  offendingClause: string | null
}

export interface MarketEcho {
  platform: string
  question: string
  marketId?: string
  resolutionText: string
  resolutionSource?: string | null
  closeDate?: string | null
  outcomes?: string[]
}

export interface ScoreResult {
  combined: number
  band: RiskBand
  dimensions: DimensionResult[]
  namedSource: string | null
  assumedVsActual: string | null
  headlineRisk: string
  summary: string
  model: string
  usage?: { inputTokens: number; outputTokens: number }
  market: MarketEcho
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Hue sweep: emerald (low) → amber (mid) → rose (high), the short way through red. */
function riskHue(score: number): number {
  const t = clamp01(score / 100)
  const hue = t < 0.5 ? 158 + (42 - 158) * (t / 0.5) : 42 + -52 * ((t - 0.5) / 0.5)
  return (hue + 360) % 360
}

/** The indicator color for a score, with optional alpha. */
export function riskColor(score: number, alpha = 1): string {
  return `hsl(${riskHue(score).toFixed(0)} 88% 62% / ${alpha})`
}

export function bandFromScore(score: number): RiskBand {
  if (score < 25) return 'low'
  if (score < 45) return 'moderate'
  if (score < 65) return 'elevated'
  if (score < 85) return 'high'
  return 'severe'
}

export const BAND_LABEL: Record<RiskBand, string> = {
  low: 'LOW',
  moderate: 'MODERATE',
  elevated: 'ELEVATED',
  high: 'HIGH',
  severe: 'SEVERE',
}

export const BAND_BLURB: Record<RiskBand, string> = {
  low: 'Resolves the way traders expect.',
  moderate: 'A pedant could quibble; unlikely to bite.',
  elevated: 'A real, specific path to a surprise.',
  high: 'A realistic, not-rare way to get burned on resolution.',
  severe: 'A clause here could blow up the market.',
}
