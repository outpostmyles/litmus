import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/v4'
import { MarketInputSchema } from '../engine/types'

/**
 * One backtest fixture: a real market that already resolved (and, for the
 * gold-set, went to a dispute or controversial settlement). `market` is the
 * blind input fed to the engine — it must contain ONLY the original
 * pre-settlement resolution text. `label` is the answer key: never fed to the
 * engine, used only to score the engine's output afterward.
 */
export const FixtureSchema = z.object({
  market: MarketInputSchema,
  label: z.object({
    caseId: z.string(),
    marketTitle: z.string(),
    /** Did this market actually go to a dispute / controversial settlement? */
    wentToDispute: z.boolean().default(true),
    /**
     * Was the ambiguity detectable from the resolution TEXT alone?
     *  STRONG/PARTIAL → the engine should catch it (true recall set).
     *  WEAK → the surprise came from outside the text (control: engine should NOT over-flag).
     */
    textDetectable: z.string().default('STRONG'),
    /** Rubric dimensions this dispute is known to exemplify. */
    expectedDimensions: z.array(z.string()).default([]),
    /** Human-readable account of what went wrong. FOR EVALUATION ONLY — never scored. */
    whatHappened: z.string().default(''),
    source: z.string().default(''),
  }),
})

export type Fixture = z.infer<typeof FixtureSchema>

export const FIXTURE_DIR = 'data/fixtures/backtest'

/** Load and validate every fixture in the directory. Returns [] if the dir is missing. */
export function loadFixtures(dir = FIXTURE_DIR): Fixture[] {
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  return files
    .sort()
    .map((f) => FixtureSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
}

/** STRONG/PARTIAL cases are the true recall set; WEAK cases are controls. */
export function isTextDetectable(fixture: Fixture): boolean {
  const t = fixture.label.textDetectable.toUpperCase()
  return t.startsWith('STRONG') || t.startsWith('PARTIAL') || t.startsWith('MIXED')
}
