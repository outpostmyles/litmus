import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MatchSchema } from './matchConfirm'
import { DivergenceSchema } from './divergenceScore'
import { baseDivergence } from './pairRisk'

// LLM stages are validated against RECORDED fixtures — real outputs captured from
// live runs (data/fixtures/crossvenue/), so schema drift or a prompt regression
// that changes the output shape fails loudly here without any API calls.
const FIXTURE_DIR = 'data/fixtures/crossvenue'

function fixtures(prefix: string): { name: string; data: unknown }[] {
  let files: string[] = []
  try {
    files = readdirSync(FIXTURE_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
  } catch {
    /* dir missing */
  }
  return files.map((f) => ({ name: f, data: JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) }))
}

describe('recorded match fixtures', () => {
  const recorded = fixtures('match-')
  it('has at least one recorded fixture', () => {
    expect(recorded.length).toBeGreaterThan(0)
  })
  for (const f of recorded) {
    it(`${f.name} parses against MatchSchema`, () => {
      const parsed = MatchSchema.parse(f.data)
      expect(['yes', 'partial', 'no']).toContain(parsed.same_event)
    })
  }
})

describe('recorded divergence fixtures', () => {
  const recorded = fixtures('divergence-')
  it('has at least one recorded fixture', () => {
    expect(recorded.length).toBeGreaterThan(0)
  })
  for (const f of recorded) {
    it(`${f.name} parses against DivergenceSchema and carries verbatim quotes`, () => {
      const parsed = DivergenceSchema.parse(f.data)
      for (const item of parsed.items) {
        expect(item.kalshi_clause.length).toBeGreaterThan(0)
        expect(item.polymarket_clause.length).toBeGreaterThan(0)
      }
      // The deterministic combine accepts every recorded shape.
      const base = baseDivergence(parsed)
      expect(base).toBeGreaterThanOrEqual(0)
      expect(base).toBeLessThanOrEqual(100)
    })
  }
})

describe('schema rejections', () => {
  it('MatchSchema rejects out-of-range confidence and unknown verdicts', () => {
    expect(() => MatchSchema.parse({ same_event: 'maybe', confidence: 0.5, reasoning: 'x' })).toThrow()
    expect(() => MatchSchema.parse({ same_event: 'yes', confidence: 1.5, reasoning: 'x' })).toThrow()
  })
  it('DivergenceSchema rejects items missing verbatim quotes', () => {
    expect(() =>
      DivergenceSchema.parse({
        items: [{ topic: 'trigger', severity: 50, explanation: 'x' }],
        scenario_that_splits: null,
        scenario_yes_venue: null,
        summary: 's',
      }),
    ).toThrow()
  })
})
