// Stage 4 of the cross-venue engine: combine divergence items into one pair-risk
// number — in CODE, not by the model, following the house pattern (weighted average
// blended with the worst item), then scale by exposure: divergence on a pair with a
// wide price gap ranks higher than the same divergence with aligned prices, because
// a price gap is exactly where arb capital is sitting.

import type { DivergenceResult } from './divergenceScore'
import { DIVERGENCE_TOPICS } from './divergenceScore'

export type DivergenceTopic = (typeof DIVERGENCE_TOPICS)[number]

/**
 * How much each divergence axis matters. Trigger definitions and one-sided
 * carveouts are what actually split settlements (announcement-vs-event, death
 * clauses); cosmetic source differences matter least often.
 */
export const TOPIC_WEIGHTS: Record<DivergenceTopic, number> = {
  trigger: 1.0,
  carveout: 0.9,
  deadline: 0.8,
  source: 0.7,
  discretion: 0.6,
  other: 0.5,
}

/** House blend: how much the single worst divergence item dominates. */
export const WORST_BLEND = 0.3

/** Without a concrete split scenario, textual differences are noise — hard cap. */
export const NO_SCENARIO_CAP = 25

/**
 * Base divergence 0–100 from the items alone (no prices). Topic-weighted average
 * blended with the worst item; capped hard when no split scenario exists.
 */
export function baseDivergence(d: Pick<DivergenceResult, 'items' | 'scenario_that_splits'>): number {
  if (!d.items.length) return d.scenario_that_splits ? 20 : 5
  let wsum = 0
  let acc = 0
  let worst = 0
  for (const it of d.items) {
    const w = TOPIC_WEIGHTS[it.topic] ?? 0.5
    acc += it.severity * w
    wsum += w
    if (it.severity > worst) worst = it.severity
  }
  const weightedAvg = acc / wsum
  let combined = Math.round((1 - WORST_BLEND) * weightedAvg + WORST_BLEND * worst)
  if (!d.scenario_that_splits) combined = Math.min(combined, NO_SCENARIO_CAP)
  return Math.max(0, Math.min(100, combined))
}

/**
 * Price gap between the two venues' Yes prices (0–1), null when either is missing.
 */
export function priceGap(kalshiPriceYes: number | null, polyPriceYes: number | null): number | null {
  if (kalshiPriceYes == null || polyPriceYes == null) return null
  return Math.abs(kalshiPriceYes - polyPriceYes)
}

/**
 * Exposure multiplier: 1.0 with aligned/unknown prices, rising linearly to 2.0 at a
 * 50¢+ gap. A gap is where arb capital sits — the audience for this number.
 */
export function exposureMultiplier(gap: number | null): number {
  if (gap == null) return 1
  return 1 + Math.min(gap, 0.5) * 2
}

/** Final pair risk 0–100: base divergence × exposure, clamped. */
export function pairRisk(
  d: Pick<DivergenceResult, 'items' | 'scenario_that_splits'>,
  kalshiPriceYes: number | null,
  polyPriceYes: number | null,
): { risk: number; base: number; gap: number | null } {
  const base = baseDivergence(d)
  const gap = priceGap(kalshiPriceYes, polyPriceYes)
  let risk = Math.max(0, Math.min(100, Math.round(base * exposureMultiplier(gap))))
  // The no-scenario cap binds the FINAL number too: without a concrete split
  // scenario, a price gap is not resolution-risk exposure — the gap reflects
  // something other than rules divergence, and the multiplier must not resurrect it.
  if (!d.scenario_that_splits) risk = Math.min(risk, NO_SCENARIO_CAP)
  return { risk, base, gap }
}
