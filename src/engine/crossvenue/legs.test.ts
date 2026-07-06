import { describe, it, expect } from 'vitest'
import { normalizeLegLabel, matchLegs, type Leg } from './legs'

const leg = (marketId: string, label: string, priceYes: number | null = 0.1): Leg => ({
  marketId,
  label,
  priceYes,
  volume: 1000,
})

describe('normalizeLegLabel', () => {
  it('folds venue phrasing onto one canonical form', () => {
    expect(normalizeLegLabel('USA')).toBe(normalizeLegLabel('United States'))
    expect(normalizeLegLabel('UK')).toBe(normalizeLegLabel('United Kingdom'))
  })
  it('is order- and punctuation-insensitive', () => {
    expect(normalizeLegLabel('Newsom, Gavin')).toBe(normalizeLegLabel('Gavin Newsom'))
    expect(normalizeLegLabel('J.D. Vance')).toBe(normalizeLegLabel('JD Vance'))
  })
})

describe('matchLegs', () => {
  it('matches exact labels across venues (the France↔France case)', () => {
    const k = [leg('KX-FRA', 'France'), leg('KX-ESP', 'Spain'), leg('KX-ENG', 'England')]
    const p = [leg('101', 'Spain'), leg('102', 'France'), leg('103', 'Brazil')]
    const m = matchLegs(k, p)
    expect(m).toHaveLength(2)
    const france = m.find((x) => x.label.includes('france'))!
    expect(france.kalshi.marketId).toBe('KX-FRA')
    expect(france.poly.marketId).toBe('102')
    expect(france.quality).toBe('exact')
  })
  it('handles alias folds (USA on Kalshi, United States on Polymarket)', () => {
    const m = matchLegs([leg('KX-USA', 'USA')], [leg('201', 'United States')])
    expect(m).toHaveLength(1)
    expect(m[0]!.quality).toBe('exact')
  })
  it('containment matches uniquely ("Gavin Newsom" vs "Gavin Newsom (D)")', () => {
    const m = matchLegs([leg('KX-GN', 'Gavin Newsom')], [leg('301', 'Gavin Newsom (D)')])
    expect(m).toHaveLength(1)
    expect(m[0]!.quality).toBe('fuzzy')
  })
  it('never guesses on ambiguity: two Smiths match nothing', () => {
    const k = [leg('KX-1', 'J. Smith'), leg('KX-2', 'A. Smith')]
    const p = [leg('401', 'Smith')]
    expect(matchLegs(k, p)).toHaveLength(0)
  })
  it('never double-assigns a leg', () => {
    const k = [leg('KX-1', 'France'), leg('KX-2', 'France B')]
    const p = [leg('501', 'France')]
    const m = matchLegs(k, p)
    expect(m.length).toBeLessThanOrEqual(1)
    const ids = m.map((x) => x.poly.marketId)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('empty labels are dropped, not matched', () => {
    expect(matchLegs([leg('KX-1', '  ')], [leg('601', '')])).toHaveLength(0)
  })
})
