import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'
import { getConfig } from '../lib/env'
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
})

const SYSTEM = `You are reading a Yes/No prediction market's LITERAL resolution rules, together with a finished resolution-risk analysis of them. Output which outcome the literal rules favor WHEN they diverge from what a casual trader assumes — the side the fine print supports that the crowd underweights.

- "no": the literal text makes YES harder than the intuitive reading — a casual "Yes" can resolve No on a technicality.
- "yes": the literal text makes YES easier than the intuitive reading — a casual "No" can resolve Yes.
- "neither": no directional tilt (ambiguity cuts both ways, e.g. pure timing risk, or the market is clean).

Ground the call in the RULES TEXT itself; the analysis is context. Also report confidence (0–1):
- 0.9+: the text is explicit — you can quote the clause that forces the divergence.
- 0.6–0.8: a real tilt, but it depends on a plausible-but-not-certain reading.
- below 0.5: you are guessing; prefer "neither" with low confidence over a weak directional call.

Give one short note naming the clause or gap that creates the lean.`

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const catalog = loadCatalog()
  const scores = loadScores()
  const byHash = new Map<string, { question: string; rules: string }>()
  for (const e of catalog) {
    if (!byHash.has(e.rulebookHash)) byHash.set(e.rulebookHash, { question: e.question, rules: e.resolutionText })
  }

  const todo = Object.entries(scores).filter(([, s]) => force || !s.literalFavors || s.leanConfidence == null)
  if (!todo.length) {
    console.log('\n  Every cached score already has a directional lean + confidence. ✓\n')
    return
  }

  const cfg = getConfig()
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  console.log(
    `\n  Deriving directional lean for ${todo.length} scores on ${MODEL}${force ? ' (forced re-run)' : ''} (~$${(todo.length * 0.005).toFixed(2)})…\n`,
  )

  let next = 0
  let done = 0
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const [hash, s] = todo[next++]!
      const ctx = byHash.get(hash)
      const q = ctx?.question || '(market)'
      const rules = ctx?.rules ? ctx.rules.slice(0, RULES_CHARS) : '(rules text unavailable — judge from the analysis alone)'
      const user =
        `Market: ${q}\n\nRESOLUTION RULES (verbatim${ctx && ctx.rules.length > RULES_CHARS ? ', truncated' : ''}):\n${rules}\n\n` +
        `ANALYSIS:\nHeadline risk: ${s.headlineRisk}\nAssumed vs actual: ${s.assumedVsActual ?? '(none stated)'}\nSummary: ${s.summary}`
      try {
        const res = await client.messages.parse({
          model: MODEL,
          max_tokens: 512,
          output_config: { format: zodOutputFormat(LeanSchema) },
          system: SYSTEM,
          messages: [{ role: 'user', content: user }],
        })
        if (!res.parsed_output) throw new Error('no structured output')
        const parsed = LeanSchema.parse(res.parsed_output)
        s.literalFavors = parsed.favors
        s.literalFavorsNote = parsed.note
        s.leanConfidence = parsed.confidence
        scores[hash] = s
        saveScores(scores)
        done++
        process.stdout.write(`  ${parsed.favors.padEnd(7)} ${Math.round(parsed.confidence * 100)}%  ${q.slice(0, 48)}\n`)
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
