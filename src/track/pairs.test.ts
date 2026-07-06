import { describe, it, expect } from 'vitest'
import { gradePairs, type PairTrack, type PairLedgerEntry } from './pairs'
import type { Track, TrackEntry } from './store'

const leg = (platform: 'Kalshi' | 'Polymarket', hash: string, marketCount = 1) => ({
  platform,
  hash,
  marketId: `${hash}-id`,
  question: `${hash} question`,
  closeDate: '2026-08-01T00:00:00Z',
  priceYesAtLock: 0.5,
  marketCount,
})

const entry = (over: Partial<PairLedgerEntry>): PairLedgerEntry => ({
  pairKey: 'k:p',
  lockedAt: '2026-07-01T00:00:00Z',
  kalshi: leg('Kalshi', 'k'),
  poly: leg('Polymarket', 'p'),
  sameEvent: 'yes',
  divergenceBase: 60,
  gapAtLock: 0.2,
  scenarioThatSplits: 'a scenario',
  settled: false,
  ...over,
})

const settledLeg = (outcome: string): TrackEntry =>
  ({
    hash: 'x',
    platform: 'Kalshi',
    marketId: 'x',
    question: 'x',
    closeDate: '2026-08-01T00:00:00Z',
    snapshotAt: '2026-07-01T00:00:00Z',
    combined: 50,
    band: 'elevated',
    headlineRisk: 'x',
    edgeSide: null,
    entryPriceYes: 0.5,
    settled: true,
    outcome: outcome as TrackEntry['outcome'],
    resolvedVia: `test result=${outcome}`,
  }) as TrackEntry

const trackWith = (kOutcome: string, pOutcome: string): Track => ({
  k: settledLeg(kOutcome),
  p: settledLeg(pOutcome),
})

describe('gradePairs settlement semantics', () => {
  it('same-event 1×1 pair with opposite outcomes is a SPLIT — the receipt', () => {
    const pt: PairTrack = { 'k:p': entry({ sameEvent: 'yes' }) }
    const { splits } = gradePairs(pt, trackWith('yes', 'no'))
    expect(pt['k:p']!.settlement).toBe('split')
    expect(splits).toBe(1)
  })
  it('PARTIAL pair with opposite outcomes is divergent-partial, NEVER a split', () => {
    const pt: PairTrack = { 'k:p': entry({ sameEvent: 'partial' }) }
    const { splits } = gradePairs(pt, trackWith('yes', 'no'))
    expect(pt['k:p']!.settlement).toBe('divergent-partial')
    expect(splits).toBe(0)
  })
  it('superseded same-event verdict is excluded from split accounting', () => {
    const pt: PairTrack = { 'k:p': entry({ sameEvent: 'yes', verdictNow: 'partial', verdictSupersededAt: 'x' }) }
    const { splits } = gradePairs(pt, trackWith('yes', 'no'))
    expect(pt['k:p']!.settlement).toBe('divergent-partial')
    expect(splits).toBe(0)
  })
  it('fan-out legs are non-comparable regardless of outcomes', () => {
    const pt: PairTrack = { 'k:p': entry({ kalshi: leg('Kalshi', 'k', 30) }) }
    const { splits } = gradePairs(pt, trackWith('yes', 'no'))
    expect(pt['k:p']!.settlement).toBe('non-comparable')
    expect(splits).toBe(0)
  })
  it('void/other on either leg is non-comparable', () => {
    const pt: PairTrack = { 'k:p': entry({}) }
    gradePairs(pt, trackWith('void', 'no'))
    expect(pt['k:p']!.settlement).toBe('non-comparable')
  })
  it('matching outcomes grade identical; provenance is carried over', () => {
    const pt: PairTrack = { 'k:p': entry({}) }
    gradePairs(pt, trackWith('no', 'no'))
    expect(pt['k:p']!.settlement).toBe('identical')
    expect(pt['k:p']!.kalshiResolvedVia).toContain('result=no')
  })
  it('is idempotent: settled entries are never regraded', () => {
    const pt: PairTrack = { 'k:p': entry({ sameEvent: 'yes' }) }
    gradePairs(pt, trackWith('yes', 'no'))
    const first = pt['k:p']!.settledAt
    const { graded } = gradePairs(pt, trackWith('no', 'no'))
    expect(graded).toBe(0)
    expect(pt['k:p']!.settledAt).toBe(first)
    expect(pt['k:p']!.settlement).toBe('split')
  })
  it('waits for both legs — one pending leg keeps the pair unsettled', () => {
    const pt: PairTrack = { 'k:p': entry({}) }
    const track = trackWith('yes', 'no')
    track.p = { ...track.p!, settled: false, outcome: undefined } as TrackEntry
    const { graded } = gradePairs(pt, track)
    expect(graded).toBe(0)
    expect(pt['k:p']!.settled).toBe(false)
  })
})
