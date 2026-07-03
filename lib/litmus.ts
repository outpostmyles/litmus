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
  /** Public web page for the market, when known. */
  url?: string | null
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
  /** Confidence of the lean (0–1), when the enrichment pass recorded one. */
  leanConfidence?: number | null
  /** Verbatim rules span forcing the divergence (required for high-confidence leans). */
  leanClauseQuote?: string | null
  /** True when the current price already reflects a correct literal reading — no edge. */
  leanCrowdConsistent?: boolean | null
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

/** An edge needs at least this much lean confidence (when the lean pass reports one). */
export const MIN_LEAN_CONFIDENCE = 0.55
/**
 * At extreme prices the bar rises to the "you can quote the clause" tier. A lean is a
 * RELATIVE claim (the fine print tilts vs. the casual reading); a 1¢ price is an ABSOLUTE
 * claim that the event is near-impossible. Calling that a dislocation asserts the crowd
 * is off by an order of magnitude — which needs a verbatim clause, not a tilt. This gate
 * is what stops threshold-market boilerplate ("a wick suffices") from minting penny
 * lotteries as "edges" — the exact artifact behind the first four paper-trade losses.
 */
export const EXTREME_COST = 0.05
export const EXTREME_MIN_CONFIDENCE = 0.85

export function edgeTag(
  literalFavors: LiteralFavors | string | null | undefined,
  priceYes: number | null | undefined,
  leanConfidence?: number | null,
  crowdConsistent?: boolean | null,
): Edge | null {
  if (!literalFavors || literalFavors === 'neither' || priceYes == null) return null
  // If the current price is already consistent with a CORRECT literal reading plus
  // ordinary event knowledge, there is no dislocation — the crowd read the fine print.
  if (crowdConsistent === true) return null
  // A hesitant lean is not a trade signal. Older cached scores have no confidence
  // recorded — those keep the previous behavior until re-enriched.
  if (leanConfidence != null && leanConfidence < MIN_LEAN_CONFIDENCE) return null

  let edge: Edge | null = null
  const pct = Math.round(priceYes * 100)
  if (literalFavors === 'no' && priceYes >= 0.6) {
    edge = { side: 'no', label: `rules → No · ${pct}¢ Yes`, strength: priceYes }
  } else if (literalFavors === 'yes' && priceYes <= 0.4) {
    edge = { side: 'yes', label: `rules → Yes · ${pct}¢ Yes`, strength: 1 - priceYes }
  }
  if (!edge) return null

  // Entry cost of the edge side. At ≤5¢ the claim is extraordinary — demand the
  // quotable-clause confidence tier (and unknown confidence doesn't qualify).
  const cost = edge.side === 'yes' ? priceYes : 1 - priceYes
  if (cost <= EXTREME_COST && !(leanConfidence != null && leanConfidence >= EXTREME_MIN_CONFIDENCE)) {
    return null
  }
  return edge
}

/**
 * How likely the market's gray zone is to matter AT ALL, proxied from the price: a
 * market at 0.05¢ needs a near-impossible event before any clause can bite; a 50/50
 * market lives in the gray zone. Saturates at 1 once the underdog side has ≥20%.
 */
export function triggerFactor(priceYes: number | null | undefined): number | null {
  if (priceYes == null) return null
  const underdog = Math.min(priceYes, 1 - priceYes)
  return Math.min(1, (2 * underdog) / 0.4)
}

/**
 * Two-number view: `combined` is the HAZARD in the text (the tool's identity — how badly
 * resolution goes IF the gray zone materializes); liveRisk discounts it by how likely the
 * gray zone is to materialize at the current price. Iran-regime-falls at 0.05¢ keeps its
 * hazard score but stops dominating the board.
 */
export function liveRisk(combined: number, priceYes: number | null | undefined): number | null {
  const t = triggerFactor(priceYes)
  return t == null ? null : Math.round(combined * t)
}

/** Humanize an ISO timestamp's age: "3h ago", "2d ago". Null when unparseable. */
export function ageOf(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const h = Math.max(0, (now - t) / 3_600_000)
  if (h < 1) return 'under 1h ago'
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Data older than this is stale — don't trade (or alert) on it. */
export const STALE_HOURS = 36

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
 * 0–100 "is this actually tradeable" score for an edge: how dislocated the price is
 * (edge strength), how soon it resolves (near-term beats a 2099 lottery), how real the
 * text trap is (resolution risk), and — the fix for the penny-lottery pathology — how
 * plausibly the gray zone can matter at this price (trigger factor). Raw strength alone
 * is MAXIMIZED at the most extreme prices, which ranked "Royals win the pennant at 0.5¢"
 * above genuine near-term traps.
 */
export function actionability(
  combined: number,
  edge: Edge | null,
  closeDate?: string | null,
  priceYes?: number | null,
): number {
  if (!edge) return 0
  const trigger = triggerFactor(priceYes) ?? 1
  return Math.round(100 * edge.strength * trigger * timeFactor(daysUntil(closeDate)) * (combined / 100))
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
