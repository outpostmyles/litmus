import { describe, it, expect } from 'vitest'
import { triage, detectNew } from './triage'
import { lockPrediction } from '../../track/lock'
import type { CatalogEntry, CachedScore } from '../../cache/store'
import type { Track } from '../../track/store'

describe('triage (pure rules)', () => {
  const base = { combined: null, band: null, priceYes: null }
  it('flags elevated+ risk', () => {
    expect(triage({ ...base, combined: 45, band: 'elevated' }).alert).toBe(true)
    expect(triage({ ...base, combined: 44, band: 'moderate' }).alert).toBe(false)
  })
  it('flags a qualifying edge under the existing gates', () => {
    const d = triage({ ...base, combined: 30, literalFavors: 'no', leanConfidence: 0.8, priceYes: 0.75 })
    expect(d.alert).toBe(true)
    expect(d.reasons.join(' ')).toContain('edge')
  })
  it('does NOT alert on a crowd-consistent or low-confidence lean (gates inherited)', () => {
    expect(
      triage({ ...base, combined: 30, literalFavors: 'no', leanConfidence: 0.8, leanCrowdConsistent: true, priceYes: 0.75 }).alert,
    ).toBe(false)
    expect(triage({ ...base, combined: 30, literalFavors: 'no', leanConfidence: 0.4, priceYes: 0.75 }).alert).toBe(false)
  })
  it('flags cross-venue divergence matches', () => {
    expect(triage({ ...base, crossvenueDivergence: true }).alert).toBe(true)
  })
  it('unscored + unmatched + no edge = quiet (Board badge only)', () => {
    expect(triage(base).alert).toBe(false)
  })
})

describe('detectNew', () => {
  it('returns only ids not in the known set', () => {
    expect(detectNew(new Set(['a', 'b']), ['a', 'b', 'c', 'd'])).toEqual(['c', 'd'])
    expect(detectNew(new Set(), ['a'])).toEqual(['a'])
    expect(detectNew(new Set(['a']), ['a'])).toEqual([])
  })
})

describe('lockPrediction — shared invariants for BOTH lanes', () => {
  const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
    platform: 'Kalshi',
    marketId: 'M1',
    rulebookHash: 'h1',
    question: 'q',
    category: 'Politics',
    resolutionText: 'rules',
    resolutionSource: null,
    outcomes: ['Yes', 'No'],
    closeDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    volume: 1,
    marketCount: 1,
    totalVolume: 1,
    priceYes: 0.5,
    priceAsOf: new Date().toISOString(),
    url: null,
    fetchedAt: new Date().toISOString(),
    ...over,
  })
  const score: CachedScore = {
    combined: 50,
    band: 'elevated',
    dimensions: [],
    namedSource: null,
    assumedVsActual: null,
    headlineRisk: 'x',
    summary: 'x',
    model: 'test',
    scoredAt: new Date().toISOString(),
  }

  it('locks once; a second lock attempt from EITHER lane is a no-op', () => {
    const track: Track = {}
    expect(lockPrediction(entry(), score, track)).toBe('locked')
    const locked = JSON.stringify(track['h1'])
    // Daily lane retries, fast lane retries — the entry must never change.
    expect(lockPrediction(entry({ priceYes: 0.9 }), score, track)).toBe('already-tracked')
    expect(lockPrediction(entry({ scanLane: 'fast', detectedAt: new Date().toISOString() }), score, track)).toBe('already-tracked')
    expect(JSON.stringify(track['h1'])).toBe(locked)
  })
  it('refuses closed markets (look-ahead) and stale prices (phantom dislocation)', () => {
    const track: Track = {}
    expect(lockPrediction(entry({ closeDate: new Date(Date.now() - 1000).toISOString() }), score, track)).toBe('closed')
    expect(
      lockPrediction(entry({ priceAsOf: new Date(Date.now() - 48 * 3_600_000).toISOString() }), score, track),
    ).toBe('stale-price')
    expect(Object.keys(track)).toHaveLength(0)
  })
  it('records scan-lane provenance so the record can prove detection-to-lock latency', () => {
    const track: Track = {}
    const detectedAt = new Date().toISOString()
    lockPrediction(entry({ scanLane: 'fast', detectedAt }), score, track)
    expect(track['h1']!.scanLane).toBe('fast')
    expect(track['h1']!.detectedAt).toBe(detectedAt)
  })
  it('unscored markets are never locked', () => {
    const track: Track = {}
    expect(lockPrediction(entry(), undefined, track)).toBe('unscored')
  })
})
