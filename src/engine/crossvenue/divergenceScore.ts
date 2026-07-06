// Stage 3 of the cross-venue engine — the core: diff two venues' rulebooks for the
// SAME event and price the risk that they settle it DIFFERENTLY. Verbatim quotes
// from BOTH rulebooks are non-negotiable: they are how Litmus stays auditable.

import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'
import { recordUsage } from '../../lib/spend'
import type { MarketBrief } from './matchConfirm'

export const DIVERGENCE_TOPICS = [
  'source',
  'deadline',
  'trigger',
  'carveout',
  'discretion',
  'other',
] as const

export const DivergenceItemSchema = z.object({
  /** Which axis the two rulebooks diverge on. */
  topic: z.enum(DIVERGENCE_TOPICS),
  /** 0–100: how likely THIS difference is to actually produce a split settlement. */
  severity: z.number().int().min(0).max(100),
  /** Verbatim span from the KALSHI rules creating the divergence. */
  kalshi_clause: z.string(),
  /** Verbatim span from the POLYMARKET rules creating the divergence. */
  polymarket_clause: z.string(),
  /** One or two sentences: why these two clauses can settle the same event apart. */
  explanation: z.string(),
})

export const DivergenceSchema = z.object({
  items: z.array(DivergenceItemSchema),
  /**
   * A CONCRETE plain-English scenario under which one venue settles Yes and the
   * other settles No. Null when no such scenario exists — in which case the pair
   * is low-divergence regardless of textual differences.
   */
  scenario_that_splits: z.string().nullable(),
  /** Which venue settles Yes in that scenario ('kalshi' | 'polymarket'), null if none. */
  scenario_yes_venue: z.enum(['kalshi', 'polymarket']).nullable(),
  /** <= 12 words: the split scenario compressed for the 3-second layer. Null with no
   * scenario; nullish so pre-field cached records still parse (backfill fills them). */
  splits_if_short: z.string().nullish(),
  /** 2–3 plain-English sentences for a trader holding both legs. */
  summary: z.string(),
})

export type DivergenceResult = z.infer<typeof DivergenceSchema>

const SYSTEM = `You are Litmus's cross-venue divergence analyst. You receive one Kalshi market and one Polymarket market CONFIRMED to reference the same underlying real-world event. Your job: find every way their WRITTEN RULES could settle that same event DIFFERENTLY.

Diff the two rulebooks specifically on:
1. RESOLUTION SOURCE — different sources of truth (different agencies, "consensus of reporting" vs a named body) that can disagree or publish at different times.
2. DEADLINE / TIMEZONE — different cutoff instants, dates, or timezone conventions; one deadline landing before the other so an event in the gap counts on one venue only.
3. TRIGGER — what counts as the event: occurrence vs announcement vs official confirmation vs signing vs enactment; definitional width (does a partial/temporary/de-facto version count?).
4. CARVEOUT — edge-case clauses on one side only: death, postponement, extra time, annulment, revision-of-figures, void conditions.
5. DISCRETION — dispute language, committee review, "sole discretion", oracle mechanics that let one venue override a literal reading.

For each material divergence return a divergence item with:
- topic, severity (0–100: how likely THIS difference is to actually split the settlement — a cosmetic wording difference that cannot change any outcome is ≤15),
- kalshi_clause and polymarket_clause: the EXACT verbatim spans from each venue's rules. Never paraphrase inside these fields. If one venue simply LACKS the clause, quote the closest governing text it does have (e.g. its general resolution sentence).
- explanation: why these two clauses can settle the same event apart.

Then the decisive test — scenario_that_splits: describe ONE concrete, plausible course of real-world events under which venue A settles Yes and venue B settles No. Name which venue is Yes in scenario_yes_venue. Also compress it to splits_if_short: <= 12 words (e.g. "a signed announcement without a ratified treaty"). If you cannot construct such a scenario, return null for all three — textual differences that cannot split a settlement are NOT divergence. Do not force items: a genuinely aligned pair should come back with few or no items and a null scenario.`

const RULES_CHARS = 5500

export function buildDivergencePrompt(kalshi: MarketBrief, poly: MarketBrief): string {
  const clip = (s: string) => (s.length > RULES_CHARS ? s.slice(0, RULES_CHARS) + ' …[truncated]' : s)
  return [
    `KALSHI market: ${kalshi.question}`,
    `Kalshi close date: ${kalshi.closeDate ?? 'unknown'}`,
    `=== KALSHI RULES (verbatim) ===\n${clip(kalshi.rules)}\n=== END KALSHI RULES ===`,
    '',
    `POLYMARKET market: ${poly.question}`,
    `Polymarket close date: ${poly.closeDate ?? 'unknown'}`,
    `=== POLYMARKET RULES (verbatim) ===\n${clip(poly.rules)}\n=== END POLYMARKET RULES ===`,
    '',
    'Diff the rulebooks and return the structured divergence result.',
  ].join('\n')
}

export async function scoreDivergence(
  client: Anthropic,
  model: string,
  kalshi: MarketBrief,
  poly: MarketBrief,
): Promise<DivergenceResult> {
  const res = await client.messages.parse({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { format: zodOutputFormat(DivergenceSchema) },
    system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: buildDivergencePrompt(kalshi, poly) }],
  })
  recordUsage('crossvenue:divergence', model, res.usage)
  if (res.stop_reason === 'refusal') throw new Error('divergence scoring was refused')
  if (!res.parsed_output) throw new Error('divergence scoring returned no structured output')
  return DivergenceSchema.parse(res.parsed_output)
}
