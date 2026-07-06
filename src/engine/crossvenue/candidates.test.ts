import { describe, it, expect } from 'vitest'
import {
  tokens,
  entityTokens,
  closeWeek,
  closeGapDays,
  pairScore,
  generateCandidates,
  type CandidateMarket,
} from './candidates'

const mk = (over: Partial<CandidateMarket>): CandidateMarket => ({
  rulebookHash: over.rulebookHash ?? Math.random().toString(36).slice(2, 10),
  platform: over.platform ?? 'Kalshi',
  question: over.question ?? '',
  category: over.category ?? 'Politics',
  closeDate: over.closeDate ?? null,
  priceYes: over.priceYes ?? null,
})

describe('tokens', () => {
  it('lowercases, strips punctuation, drops stopwords and applies aliases', () => {
    expect(tokens('Will Trump acquire Greenland before 2027?')).toEqual(['trump', 'buy', 'greenland', '2027'])
  })
  it('folds cross-venue synonyms onto one token', () => {
    const a = tokens('Will Trump buy at least part of Greenland?')
    const b = tokens('Will Trump acquire Greenland before 2027?')
    expect(a).toContain('buy')
    expect(b).toContain('buy')
  })
  it('keeps dollar amounts and tickers', () => {
    expect(tokens('Will Bitcoin hit $150k by June 30, 2026?')).toContain('btc')
    expect(tokens('Will Bitcoin hit $150k by June 30, 2026?')).toContain('$150k')
  })
})

describe('entityTokens', () => {
  it('extracts capitalized entities and years from original casing', () => {
    const e = entityTokens('Will China invade Taiwan by end of 2026?')
    expect(e).toContain('china')
    expect(e).toContain('taiwan')
    expect(e).toContain('2026')
  })
  it('does not extract lowercase glue words', () => {
    expect(entityTokens('will something happen before then?')).toEqual([])
  })
})

describe('closeWeek / closeGapDays', () => {
  it('buckets dates into epoch-week numbers and is null-safe', () => {
    expect(closeWeek('2026-07-01T00:00:00Z')).toBeTypeOf('number')
    // Adjacent days differ by at most one bucket (neighbors are always queried too).
    const dec31 = closeWeek('2026-12-31')!
    const jan1 = closeWeek('2027-01-01')!
    expect(Math.abs(jan1 - dec31)).toBeLessThanOrEqual(1)
    expect(closeWeek(null)).toBeNull()
    expect(closeWeek('not a date')).toBeNull()
  })
  it('computes day gaps, Infinity when unknown', () => {
    expect(closeGapDays('2026-07-01', '2026-07-11')).toBe(10)
    expect(closeGapDays(null, '2026-07-11')).toBe(Infinity)
  })
})

describe('pairScore', () => {
  const greenlandK = mk({ question: 'Will Trump buy at least part of Greenland?', closeDate: '2029-01-20' })
  const greenlandP = mk({
    platform: 'Polymarket',
    question: 'Will Trump acquire Greenland before 2027?',
    closeDate: '2026-12-31',
  })
  const worldCup = mk({ platform: 'Polymarket', question: 'Will USA win the 2026 FIFA World Cup?', closeDate: '2026-07-20' })

  it('scores a true cross-venue pair well above an unrelated one', () => {
    const same = pairScore(greenlandK, greenlandP).score
    const diff = pairScore(greenlandK, worldCup).score
    expect(same).toBeGreaterThan(0.3)
    expect(diff).toBeLessThan(0.15)
    expect(same).toBeGreaterThan(diff * 2)
  })
  it('reports the shared tokens for auditability', () => {
    const { sharedTokens } = pairScore(greenlandK, greenlandP)
    expect(sharedTokens).toContain('greenland')
    expect(sharedTokens).toContain('trump')
  })
})

describe('generateCandidates', () => {
  it('finds pairs sharing an entity block and respects the threshold', () => {
    const kalshi = [
      mk({ rulebookHash: 'k1', question: 'Will Trump buy at least part of Greenland?', closeDate: '2029-01-20' }),
      mk({ rulebookHash: 'k2', question: 'Will the Fed cut rates in September?', closeDate: '2026-09-17' }),
    ]
    const poly = [
      mk({ rulebookHash: 'p1', platform: 'Polymarket', question: 'Will Trump acquire Greenland before 2027?', closeDate: '2026-12-31' }),
      mk({ rulebookHash: 'p2', platform: 'Polymarket', question: 'Will Oceania win the 2026 FIFA World Cup?', closeDate: '2026-07-20' }),
    ]
    const out = generateCandidates(kalshi, poly, { threshold: 0.25 })
    expect(out.map((c) => `${c.kalshiHash}:${c.polyHash}`)).toContain('k1:p1')
    expect(out.map((c) => `${c.kalshiHash}:${c.polyHash}`)).not.toContain('k1:p2')
  })
  it('never emits duplicate pairs and sorts by score descending', () => {
    const kalshi = [mk({ rulebookHash: 'k1', question: 'Will China invade Taiwan by end of 2026?', closeDate: '2026-12-31' })]
    const poly = [
      mk({ rulebookHash: 'p1', platform: 'Polymarket', question: 'Will China invade Taiwan by end of 2026?', closeDate: '2026-12-31' }),
      mk({ rulebookHash: 'p2', platform: 'Polymarket', question: 'China x Taiwan military action in 2026?', closeDate: '2026-12-31' }),
    ]
    const out = generateCandidates(kalshi, poly, { threshold: 0.05 })
    const keys = out.map((c) => `${c.kalshiHash}:${c.polyHash}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.score).toBeGreaterThanOrEqual(out[i]!.score)
    expect(out[0]!.polyHash).toBe('p1') // identical question outranks the paraphrase
  })
  it('scales via blocking: unrelated markets in different weeks generate no work', () => {
    const kalshi = [mk({ rulebookHash: 'k1', question: 'Something about xylophones', closeDate: '2026-01-01' })]
    const poly = [mk({ rulebookHash: 'p1', platform: 'Polymarket', question: 'Entirely unrelated quasars', closeDate: '2027-06-06' })]
    expect(generateCandidates(kalshi, poly)).toHaveLength(0)
  })

  // Regressions from adversarial review: blocking recall at boundaries.
  it('a one-day close gap across a year boundary can never split a pair', () => {
    const kalshi = [mk({ rulebookHash: 'k1', question: 'will inflation top 5% this winter?', closeDate: '2026-12-31' })]
    const poly = [mk({ rulebookHash: 'p1', platform: 'Polymarket', question: 'will inflation top 5% this winter?', closeDate: '2027-01-01' })]
    const out = generateCandidates(kalshi, poly, { threshold: 0.3 })
    expect(out).toHaveLength(1)
  })
  it('lowercase-heavy titles with no entities still block via informative tokens', () => {
    const kalshi = [mk({ rulebookHash: 'k1', question: 'Fed rate cut in September?', closeDate: '2026-09-17' })]
    const poly = [
      mk({ rulebookHash: 'p1', platform: 'Polymarket', question: 'will the federal reserve cut rates in september?', closeDate: '2026-09-30' }),
    ]
    const out = generateCandidates(kalshi, poly, { threshold: 0.25 })
    expect(out.map((c) => `${c.kalshiHash}:${c.polyHash}`)).toContain('k1:p1')
  })
})

describe('collocation aliases (no false merges)', () => {
  it('World Cup folds to worldcup; Stanley Cup does not', () => {
    expect(tokens('Will USA win the 2026 World Cup?')).toContain('worldcup')
    const stanley = tokens('Will the Panthers win the 2026 Stanley Cup?')
    expect(stanley).not.toContain('worldcup')
    expect(stanley).toContain('stanley')
  })
  it('Federal Reserve folds to fed; a Strategic Bitcoin Reserve does not', () => {
    expect(tokens('Will the Federal Reserve cut rates?')).toContain('fed')
    const sbr = tokens('Will the US establish a Strategic Bitcoin Reserve in 2026?')
    expect(sbr).not.toContain('fed')
  })
  it('acronym entities (EU, UK) and clean money entities are extracted', () => {
    expect(entityTokens('Will the EU sanction the UK by 2027?')).toEqual(expect.arrayContaining(['eu', 'uk']))
    expect(entityTokens('Will it cost $150,000.')).toContain('$150,000')
  })
})
