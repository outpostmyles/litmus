import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'
import { getConfig } from '../lib/env'
import { recordUsage, budgetAllows, confirmLargeRun } from '../lib/spend'
import { loadCatalog, loadScores, saveScores } from './store'

// A market's directional lean is a narrow read grounded in the RULES TEXT plus the
// analysis we already paid for, so we derive it cheaply (Haiku) instead of re-scoring
// on Opus. v2: the pass reads the actual resolution text — not just the Opus prose —
// and reports a confidence; edges require confidence ≥ 0.55 (lib/litmus.ts).
//
// `npm run enrich -- --force` re-derives every lean (e.g. after a prompt upgrade).
const MODEL = process.env.LEAN_MODEL || 'claude-haiku-4-5'
const CONCURRENCY = 5
/** Rules text is truncated to keep the pass cheap; the trap is almost always early. */
const RULES_CHARS = 6000

const LeanSchema = z.object({
  favors: z.enum(['yes', 'no', 'neither']),
  confidence: z.number().min(0).max(1),
  note: z.string(),
  /** Verbatim span of the rules forcing the divergence. REQUIRED when confidence ≥ 0.85. */
  clauseQuote: z.string().nullable(),
  /** Could the current price already reflect a CORRECT literal reading + ordinary event knowledge? */
  crowdConsistent: z.boolean(),
})

const SYSTEM = `You are reading a Yes/No prediction market's LITERAL resolution rules, together with its current market price and a finished resolution-risk analysis. Output which outcome the literal rules favor WHEN they diverge from what a casual trader assumes — the side the fine print supports that the crowd underweights.

- "no": the literal text makes YES harder than the intuitive reading — a casual "Yes" can resolve No on a technicality.
- "yes": the literal text makes YES easier than the intuitive reading — a casual "No" can resolve Yes.
- "neither": no directional tilt (ambiguity cuts both ways, e.g. pure timing risk, or the market is clean).

Ground the call in the RULES TEXT itself; the analysis is context. Report confidence (0–1):
- 0.85+: the text is EXPLICIT — you must supply clauseQuote, the verbatim span that forces the divergence. No quote, no high confidence.
- 0.6–0.8: a real tilt, but it depends on a plausible-but-not-certain reading. clauseQuote optional.
- below 0.5: you are guessing; prefer "neither" with low confidence over a weak directional call.
Spread your confidence honestly across this range — a default-to-0.75 habit makes the number useless.

Then answer crowdConsistent: could the CURRENT PRICE plausibly reflect traders who read the fine print correctly AND know ordinary facts about the world? Think hard here:
- A market at 1¢ is usually priced low because the EVENT is unlikely, not because the crowd misread the rules. Loose trigger language does not make a near-impossible event mispriced. If the price is explained by event probability, answer true.
- A lopsided price on an EMPIRICAL question (a vote margin, a measured statistic) usually reflects real information (polls, counts) — a rules technicality does not overturn it. Answer true.
- Answer false ONLY when you can articulate why traders at this price are likely misreading or ignoring the specific clause — the fine print, not the event odds, explains the gap.

Give one short note naming the clause or gap that creates the lean.`

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const catalog = loadCatalog()
  const scores = loadScores()
  const byHash = new Map<string, { question: string; rules: string; priceYes: number | null }>()
  for (const e of catalog) {
    if (!byHash.has(e.rulebookHash)) {
      byHash.set(e.rulebookHash, { question: e.question, rules: e.resolutionText, priceYes: e.priceYes ?? null })
    }
  }

  const todo = Object.entries(scores).filter(
    ([, s]) => force || !s.literalFavors || s.leanConfidence == null || s.leanCrowdConsistent == null,
  )
  if (!todo.length) {
    console.log('\n  Every cached score already has a directional lean + confidence. ✓\n')
    return
  }

  if (!(await confirmLargeRun(todo.length, todo.length * 0.005, 'enrich'))) return

  const cfg = getConfig()
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  console.log(
    `\n  Deriving directional lean for ${todo.length} scores on ${MODEL}${force ? ' (forced re-run)' : ''} (~$${(todo.length * 0.005).toFixed(2)})…\n`,
  )

  let next = 0
  let done = 0
  let deferred = 0
  async function worker(): Promise<void> {
    while (next < todo.length) {
      if (!budgetAllows().ok) {
        deferred += todo.length - next
        next = todo.length
        console.log(`  budget exhausted — deferring ${deferred} leans to a later run.`)
        return
      }
      const [hash, s] = todo[next++]!
      const ctx = byHash.get(hash)
      const q = ctx?.question || '(market)'
      const rules = ctx?.rules ? ctx.rules.slice(0, RULES_CHARS) : '(rules text unavailable — judge from the analysis alone)'
      const priceLine =
        ctx?.priceYes != null ? `Current market price: Yes ${Math.round(ctx.priceYes * 100)}¢` : 'Current market price: unknown'
      const user =
        `Market: ${q}\n${priceLine}\n\nRESOLUTION RULES (verbatim${ctx && ctx.rules.length > RULES_CHARS ? ', truncated' : ''}):\n${rules}\n\n` +
        `ANALYSIS:\nHeadline risk: ${s.headlineRisk}\nAssumed vs actual: ${s.assumedVsActual ?? '(none stated)'}\nSummary: ${s.summary}`
      try {
        const res = await client.messages.parse({
          model: MODEL,
          max_tokens: 700,
          output_config: { format: zodOutputFormat(LeanSchema) },
          system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
          messages: [{ role: 'user', content: user }],
        })
        recordUsage('lean', MODEL, res.usage)
        if (!res.parsed_output) throw new Error('no structured output')
        const parsed = LeanSchema.parse(res.parsed_output)
        s.literalFavors = parsed.favors
        s.literalFavorsNote = parsed.note
        // High confidence must be earned with a verbatim quote — cap it otherwise.
        s.leanConfidence =
          parsed.confidence >= 0.85 && !parsed.clauseQuote?.trim() ? 0.8 : parsed.confidence
        s.leanClauseQuote = parsed.clauseQuote?.trim() || null
        s.leanCrowdConsistent = parsed.crowdConsistent
        scores[hash] = s
        saveScores(scores)
        done++
        process.stdout.write(
          `  ${parsed.favors.padEnd(7)} ${Math.round(parsed.confidence * 100)}%${parsed.crowdConsistent ? ' crowd-ok' : '        '}  ${q.slice(0, 44)}\n`,
        )
      } catch (err) {
        process.stdout.write(`  err     ${q.slice(0, 54)} — ${err instanceof Error ? err.message : String(err)}\n`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()))
  console.log(`\n  Directional lean added to ${done} scores.\n`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
