import { describe, it, expect } from 'vitest'
import { gateVerdict, type Verdict } from './verdict'

const v = (over: Partial<Verdict> = {}): Verdict => ({
  lean: 'NO',
  lean_confidence: 0.8,
  trap_phrase: 'partial control counts',
  killer_clause: 'An announcement that the leader will leave office also counts.',
  so_what: 'a mere announcement settles this Yes',
  ...over,
})

const RULES = 'Payout Criterion: An announcement that the   leader will leave office also counts. Other text.'

describe('gateVerdict — the short layer never overclaims', () => {
  it('passes a verbatim clause through (whitespace/quote normalization allowed)', () => {
    const g = gateVerdict(v(), [RULES])
    expect(g.lean).toBe('NO')
    expect(g.killer_clause).toContain('announcement')
  })
  it('a non-verbatim clause collapses the lean to UNCLEAR and drops the quote', () => {
    const g = gateVerdict(v({ killer_clause: 'a paraphrase the rules never say' }), [RULES])
    expect(g.lean).toBe('UNCLEAR')
    expect(g.killer_clause).toBeNull()
    expect(g.lean_confidence).toBeLessThanOrEqual(0.4)
  })
  it('no clause at all → UNCLEAR (never a confident lean without a quote)', () => {
    const g = gateVerdict(v({ killer_clause: null }), [RULES])
    expect(g.lean).toBe('UNCLEAR')
  })
  it('word caps enforced: trap ≤8, so_what ≤15', () => {
    const g = gateVerdict(
      v({ trap_phrase: 'one two three four five six seven eight nine ten', so_what: Array(20).fill('w').join(' ') }),
      [RULES],
    )
    expect(g.trap_phrase.split(' ')).toHaveLength(8)
    expect(g.so_what.split(' ')).toHaveLength(15)
  })
  it('gates against fallback sources (stored offending clauses) when rules are gone', () => {
    const g = gateVerdict(v(), [null, undefined, 'An announcement that the leader will leave office also counts.'])
    expect(g.lean).toBe('NO')
  })
})

describe('gateSides — stances never contradict the lean', () => {
  const sides = (yes: 'HELPS' | 'HURTS' | 'NEUTRAL' | 'UNCLEAR', no: typeof yes) => ({
    yes_holder: { stance: yes, line: 'a line for yes holders' },
    no_holder: { stance: no, line: 'a line for no holders' },
    holder_note: null,
  })
  it('consistent sides pass: lean NO helps NO holders, hurts YES holders', () => {
    const g = gateVerdict(v({ ...sides('HURTS', 'HELPS') }), [RULES])
    expect(g.yes_holder!.stance).toBe('HURTS')
    expect(g.no_holder!.stance).toBe('HELPS')
  })
  it('a contradiction collapses BOTH sides to UNCLEAR (never invent asymmetry)', () => {
    const g = gateVerdict(v({ ...sides('HELPS', 'HURTS') }), [RULES]) // lean NO but yes=HELPS
    expect(g.yes_holder!.stance).toBe('UNCLEAR')
    expect(g.no_holder!.stance).toBe('UNCLEAR')
  })
  it('UNCLEAR lean forbids directional stances but keeps NEUTRAL', () => {
    const g = gateVerdict(v({ killer_clause: null, ...sides('HURTS', 'NEUTRAL') }), [RULES])
    expect(g.lean).toBe('UNCLEAR')
    expect(g.yes_holder!.stance).toBe('UNCLEAR')
    expect(g.no_holder!.stance).toBe('NEUTRAL')
  })
  it('caps side lines at 18 words and holder_note at 15', () => {
    const long = Array(25).fill('w').join(' ')
    const g = gateVerdict(
      v({ yes_holder: { stance: 'HURTS', line: long }, no_holder: { stance: 'HELPS', line: long }, holder_note: long }),
      [RULES],
    )
    expect(g.no_holder!.line.split(' ')).toHaveLength(18)
    expect(g.holder_note!.split(' ')).toHaveLength(15)
  })
  it('absent sides pass through untouched (pre-P11 verdicts)', () => {
    const g = gateVerdict(v(), [RULES])
    expect(g.yes_holder).toBeUndefined()
  })
})
