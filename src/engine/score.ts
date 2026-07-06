import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { getConfig } from '../lib/env'
import { recordUsage } from '../lib/spend'
import { ScoreSchema, type MarketInput, type RawScore } from './types'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  WEIGHTS,
  combineScore,
  riskBand,
  type Dimension,
  type RiskBand,
} from './weights'

export interface DimensionResult {
  key: Dimension
  label: string
  score: number
  weight: number
  reasoning: string
  offendingClause: string | null
}

export interface LitmusScore {
  combined: number
  band: RiskBand
  dimensions: DimensionResult[]
  namedSource: string | null
  assumedVsActual: string | null
  headlineRisk: string
  summary: string
  model: string
  usage: { inputTokens: number; outputTokens: number }
  raw: RawScore
}

export interface ScoreOptions {
  /** Reasoning depth. Defaults to "high" — correctness matters more than cost for a judge. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Reuse a client across many calls (e.g. the backtest) instead of constructing per market. */
  client?: Anthropic
}

/**
 * Score one market's resolution text on the five-dimension rubric. The model
 * returns per-dimension scores + reasoning + the offending clause; the combined
 * 0–100 score is computed deterministically in code (see weights.ts), so the
 * weighting is consistent and auditable rather than a model whim.
 */
export async function scoreMarket(market: MarketInput, opts: ScoreOptions = {}): Promise<LitmusScore> {
  const config = getConfig()
  const client = opts.client ?? new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL })

  const response = await client.messages.parse({
    model: config.model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: opts.effort ?? 'high',
      format: zodOutputFormat(ScoreSchema),
    },
    // The rubric is identical for every market in a run — prompt caching makes
    // repeat reads bill at ~10% of standard input.
    system: [{ type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: buildUserPrompt(market) }],
  })
  recordUsage('score', config.model, response.usage)

  if (response.stop_reason === 'refusal') {
    throw new Error('The model refused to score this market (safety classifier).')
  }
  if (!response.parsed_output) {
    throw new Error('The model did not return a valid structured score.')
  }
  // The SDK validates against the schema, but re-parsing pins the static type
  // (parsed_output is loosely typed) and is a cheap second safety net.
  const parsed = ScoreSchema.parse(response.parsed_output)

  const dimScores: Record<Dimension, number> = {
    source_clarity: parsed.source_clarity.score,
    criteria_precision: parsed.criteria_precision.score,
    literal_vs_intuitive: parsed.literal_vs_intuitive.score,
    timing: parsed.timing.score,
    dispute_surface: parsed.dispute_surface.score,
  }

  const combined = combineScore(dimScores)
  const dimensions: DimensionResult[] = DIMENSIONS.map((key) => ({
    key,
    label: DIMENSION_LABELS[key],
    score: parsed[key].score,
    weight: WEIGHTS[key],
    reasoning: parsed[key].reasoning,
    offendingClause: parsed[key].offending_clause,
  }))

  return {
    combined,
    band: riskBand(combined),
    dimensions,
    namedSource: parsed.named_source,
    assumedVsActual: parsed.assumed_vs_actual,
    headlineRisk: parsed.headline_risk,
    summary: parsed.summary,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    raw: parsed,
  }
}
