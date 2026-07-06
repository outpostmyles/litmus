import { describe, it, expect } from 'vitest'
import { baseDivergence, priceGap, exposureMultiplier, pairRisk, NO_SCENARIO_CAP, TOPIC_WEIGHTS, WORST_BLEND } from './pairRisk'
import type { DivergenceResult } from './divergenceScore'

const item = (topic: DivergenceResult['items'][number]['topic'], severity: number) => ({
  topic,
  severity,
  kalshi_clause: 'k',
  polymarket_clause: 'p',
  explanation: 'x',
})

describe('baseDivergence', () => {
  it('computes the topic-weighted average blended with the worst item (house pattern)', () => {
    const d = { items: [item('trigger', 80), item('source', 40)], scenario_that_splits: 'a scenario' }
    const wavg = (80 * TOPIC_WEIGHTS.trigger + 40 * TOPIC_WEIGHTS.source) / (TOPIC_WEIGHTS.trigger + TOPIC_WEIGHTS.source)
    const expected = Math.round((1 - WORST_BLEND) * wavg + WORST_BLEND * 80)
    expect(baseDivergence(d)).toBe(expected)
  })
  it('hard-caps when no split scenario exists — textual differences alone are not divergence', () => {
    const d = { items: [item('trigger', 95), item('carveout', 90)], scenario_that_splits: null }
    expect(baseDivergence(d)).toBeLessThanOrEqual(NO_SCENARIO_CAP)
  })
  it('handles empty items: low, lower still without a scenario', () => {
    expect(baseDivergence({ items: [], scenario_that_splits: 'x' })).toBe(20)
    expect(baseDivergence({ items: [], scenario_that_splits: null })).toBe(5)
  })
  it('clamps into 0–100', () => {
    const d = { items: [item('trigger', 100)], scenario_that_splits: 'x' }
    expect(baseDivergence(d)).toBeLessThanOrEqual(100)
    expect(baseDivergence(d)).toBeGreaterThanOrEqual(0)
  })
})

describe('priceGap / exposureMultiplier', () => {
  it('gap is null when either price is missing', () => {
    expect(priceGap(null, 0.5)).toBeNull()
    expect(priceGap(0.5, null)).toBeNull()
    expect(priceGap(0.9, 0.6)).toBeCloseTo(0.3)
  })
  it('multiplier: 1 at aligned/unknown, 2 at a 50¢+ gap, linear between', () => {
    expect(exposureMultiplier(null)).toBe(1)
    expect(exposureMultiplier(0)).toBe(1)
    expect(exposureMultiplier(0.25)).toBeCloseTo(1.5)
    expect(exposureMultiplier(0.5)).toBe(2)
    expect(exposureMultiplier(0.8)).toBe(2) // capped
  })
})

describe('pairRisk', () => {
  const d = { items: [item('trigger', 60)], scenario_that_splits: 'one venue counts an announcement' }
  it('ranks the same divergence higher when a price gap exists', () => {
    const aligned = pairRisk(d, 0.5, 0.5).risk
    const gapped = pairRisk(d, 0.9, 0.4).risk
    expect(gapped).toBeGreaterThan(aligned)
  })
  it('clamps at 100 and never goes negative', () => {
    const severe = { items: [item('trigger', 100), item('carveout', 100)], scenario_that_splits: 'x' }
    expect(pairRisk(severe, 0.99, 0.01).risk).toBe(100)
    expect(pairRisk({ items: [], scenario_that_splits: null }, 0.5, 0.5).risk).toBeGreaterThanOrEqual(0)
  })
  it('unknown prices fall back to base (multiplier 1)', () => {
    const { risk, base } = pairRisk(d, null, 0.4)
    expect(risk).toBe(base)
  })
  it('the no-scenario cap binds the FINAL risk — a price gap cannot resurrect it', () => {
    const noScenario = { items: [item('trigger', 95)], scenario_that_splits: null }
    expect(pairRisk(noScenario, 0.9, 0.2).risk).toBeLessThanOrEqual(NO_SCENARIO_CAP)
    expect(pairRisk(noScenario, 0.99, 0.01).risk).toBeLessThanOrEqual(NO_SCENARIO_CAP)
  })
})
