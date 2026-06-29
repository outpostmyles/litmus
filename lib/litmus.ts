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
  /** Current implied probability of "Yes" (0–1), as last fetched. */
  priceYes?: number | null
}

/** Which outcome the LITERAL rules favor when they diverge from the intuitive reading. */
export type LiteralFavors = 'yes' | 'no' | 'neither'

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
  /** Direction the literal rules lean vs. the intuitive reading (enrichment layer). */
  literalFavors?: LiteralFavors | null
  literalFavorsNote?: string | null
}

/**
 * A flag when the literal lean disagrees with how the crowd is pricing the market —
 * the seed of a trade idea: the rules favor one side, the price favors the other.
 */
export interface Edge {
  side: 'yes' | 'no'
  label: string
  /** 0–1, how far the price is from the rules-favored side. */
  strength: number
}

export function edgeTag(
  literalFavors: LiteralFavors | string | null | undefined,
  priceYes: number | null | undefined,
): Edge | null {
  if (!literalFavors || literalFavors === 'neither' || priceYes == null) return null
  const pct = Math.round(priceYes * 100)
  if (literalFavors === 'no' && priceYes >= 0.6) {
    return { side: 'no', label: `rules → No · ${pct}¢ Yes`, strength: priceYes }
  }
  if (literalFavors === 'yes' && priceYes <= 0.4) {
    return { side: 'yes', label: `rules → Yes · ${pct}¢ Yes`, strength: 1 - priceYes }
  }
  return null
}

/** Days until close (negative = already past), or null. */
export function daysUntil(closeDate?: string | null): number | null {
  if (!closeDate) return null
  const t = new Date(closeDate).getTime()
  if (Number.isNaN(t)) return null
  return (t - Date.now()) / 86_400_000
}

function timeFactor(days: number | null): number {
  if (days == null) return 0.3
  if (days < 0) return 0.05
  if (days <= 30) return 1
  if (days <= 90) return 0.8
  if (days <= 365) return 0.5
  if (days <= 730) return 0.25
  return 0.1
}

/**
 * 0–100 "is this actually tradeable" score for an edge: combines how dislocated
 * the price is (edge strength), how soon it resolves (near-term beats a 2099
 * lottery), and how real the text trap is (resolution risk).
 */
export function actionability(combined: number, edge: Edge | null, closeDate?: string | null): number {
  if (!edge) return 0
  return Math.round(100 * edge.strength * timeFactor(daysUntil(closeDate)) * (combined / 100))
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
