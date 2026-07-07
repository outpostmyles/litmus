// Use the v4 API surface (shipped under this subpath by zod 3.25+) to match
// the Anthropic SDK's zodOutputFormat helper, which imports from 'zod/v4'.
import * as z from 'zod/v4'
import { VerdictSchema } from './verdict'

/**
 * Input to the scoring engine: one market's question + full resolution text +
 * the metadata a human would glance at before trading. Resolution text is the
 * only thing the rubric truly needs; everything else is context.
 */
export interface MarketInput {
  platform: string
  marketId?: string
  question: string
  resolutionText: string
  /** A named settlement source, if the platform exposes one as a separate field. */
  resolutionSource?: string | null
  closeDate?: string | null
  expectedResolutionDate?: string | null
  outcomes?: string[]
  volume?: number | null
  liquidity?: number | null
  /** Public web page for the market, when known. Context only — never scored. */
  url?: string | null
  /** Current implied Yes price (0–1) when the venue exposes one. Context, never scored. */
  priceYes?: number | null
}

/** Loose parser for CLI / fixture input. Tolerant of missing optional fields. */
export const MarketInputSchema = z.object({
  platform: z.string().default('Unknown'),
  marketId: z.string().optional(),
  question: z.string().min(1, 'question is required'),
  resolutionText: z.string().min(1, 'resolutionText is required'),
  resolutionSource: z.string().nullish(),
  closeDate: z.string().nullish(),
  expectedResolutionDate: z.string().nullish(),
  outcomes: z.array(z.string()).optional(),
  volume: z.number().nullish(),
  liquidity: z.number().nullish(),
  url: z.string().nullish(),
})

/**
 * One rubric dimension as the model returns it. Higher score = more resolution
 * risk. `offending_clause` is the verbatim span of resolution text that earned
 * the flag, or null when the dimension is genuinely clean.
 */
const DimensionSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasoning: z.string(),
  offending_clause: z.string().nullable(),
})

/**
 * The full structured output the model is constrained to produce. Validated by
 * the SDK against this schema (via zodOutputFormat), so a successful parse is a
 * guaranteed-shaped object — no defensive parsing downstream.
 */
export const ScoreSchema = z.object({
  source_clarity: DimensionSchema,
  criteria_precision: DimensionSchema,
  literal_vs_intuitive: DimensionSchema,
  timing: DimensionSchema,
  dispute_surface: DimensionSchema,
  /** What the resolution source actually is, paraphrased — or null if none is named. */
  named_source: z.string().nullable(),
  /** "Casual reading: X. Literal text: Y." when those diverge, else null. */
  assumed_vs_actual: z.string().nullable(),
  /** The single sharpest way this market could surprise its traders. */
  headline_risk: z.string(),
  /** 2–4 plain-English sentences, verdict first, for a pre-trade glance. */
  summary: z.string(),
  /** The 3-second layer: lean + trap phrase + the ONE killer clause + so-what. */
  verdict: VerdictSchema,
})

export type RawScore = z.infer<typeof ScoreSchema>
