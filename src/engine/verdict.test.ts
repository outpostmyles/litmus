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
