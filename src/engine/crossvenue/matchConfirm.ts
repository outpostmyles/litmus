// Stage 2 of the cross-venue engine: LLM confirmation that a candidate pair really
// references the same underlying real-world event. One structured call per pair,
// cached upstream by the pair of rulebook hashes — a pair is never paid for twice.

import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'

export const MatchSchema = z.object({
  /**
   * yes      — both markets resolve on the same underlying event.
   * partial  — related but not identical (one on the event, one on an announcement /
   *            a sub-question / a different threshold of the same story). The most
   *            dangerous kind for an arb trader: legs that look paired but aren't.
   * no       — different events that merely share words.
   */
  same_event: z.enum(['yes', 'partial', 'no']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

export type MatchResult = z.infer<typeof MatchSchema>

const SYSTEM = `You compare one Kalshi market and one Polymarket market and decide whether they reference the SAME underlying real-world event.

- "yes": a single real-world occurrence settles both. Different wording, sources, or deadlines do NOT make it "no" — those differences are exactly what the next stage diffs. The test: is there ONE event out in the world that both contracts are fundamentally about?
- "partial": related but not the same resolvable question — one is on the event and the other on an ANNOUNCEMENT or intention of it; one is a sub-case, a different threshold, a different time horizon of the same storyline. Partial pairs look hedgeable but are not — flag them.
- "no": superficial word overlap only.

FAN-OUT TRAP: one venue's market is often a multi-candidate EVENT (rules written as a template — "<candidate>", "the person who...") while the other is a single specific leg ("Will LeBron James win..."). Those are NOT "yes" unless both sides resolve on the SAME specific leg — a Kalshi contract that pays on Rubio and a Polymarket contract that pays on LeBron never hedge each other. Classify template-vs-specific-leg pairs as "partial" and say which legs differ in the reasoning.

Judge from the titles AND the rules text. Be strict: "same storyline" is not "same event".`

export interface MarketBrief {
  question: string
  rules: string
  closeDate: string | null
}

const RULES_CHARS = 3500

export function buildMatchPrompt(kalshi: MarketBrief, poly: MarketBrief): string {
  const clip = (s: string) => (s.length > RULES_CHARS ? s.slice(0, RULES_CHARS) + ' …[truncated]' : s)
  return [
    `KALSHI market: ${kalshi.question}`,
    `Kalshi close date: ${kalshi.closeDate ?? 'unknown'}`,
    `Kalshi rules:\n${clip(kalshi.rules)}`,
    '',
    `POLYMARKET market: ${poly.question}`,
    `Polymarket close date: ${poly.closeDate ?? 'unknown'}`,
    `Polymarket rules:\n${clip(poly.rules)}`,
    '',
    'Same underlying event?',
  ].join('\n')
}

export async function confirmMatch(
  client: Anthropic,
  model: string,
  kalshi: MarketBrief,
  poly: MarketBrief,
): Promise<MatchResult> {
  const res = await client.messages.parse({
    model,
    max_tokens: 600,
    output_config: { format: zodOutputFormat(MatchSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildMatchPrompt(kalshi, poly) }],
  })
  if (!res.parsed_output) throw new Error('match confirmation returned no structured output')
  return MatchSchema.parse(res.parsed_output)
}
