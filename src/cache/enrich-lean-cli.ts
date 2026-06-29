import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'
import { getConfig } from '../lib/env'
import { loadCatalog, loadScores, saveScores } from './store'

// A market's directional lean is a narrow read of the analysis we already paid for,
// so we derive it cheaply (Haiku) instead of re-scoring on Opus.
const MODEL = process.env.LEAN_MODEL || 'claude-haiku-4-5'
const CONCURRENCY = 5

const LeanSchema = z.object({
  favors: z.enum(['yes', 'no', 'neither']),
  note: z.string(),
})

const SYSTEM = `You are reading a finished resolution-risk analysis of a Yes/No prediction market. Output which outcome the LITERAL resolution rules favor WHEN they diverge from what a casual trader assumes — the side the fine print supports that the crowd underweights.

- "no": the literal text makes YES harder than the intuitive reading — a casual "Yes" can resolve No on a technicality.
- "yes": the literal text makes YES easier than the intuitive reading — a casual "No" can resolve Yes.
- "neither": no directional tilt (ambiguity cuts both ways, e.g. pure timing risk, or the market is clean).

Base it only on the provided analysis. Give one short note explaining the lean.`

async function main(): Promise<void> {
  const catalog = loadCatalog()
  const scores = loadScores()
  const questionByHash = new Map<string, string>()
  for (const e of catalog) if (!questionByHash.has(e.rulebookHash)) questionByHash.set(e.rulebookHash, e.question)

  const todo = Object.entries(scores).filter(([, s]) => !s.literalFavors)
  if (!todo.length) {
    console.log('\n  Every cached score already has a directional lean. ✓\n')
    return
  }

  const cfg = getConfig()
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  console.log(`\n  Deriving directional lean for ${todo.length} scores on ${MODEL} (~$${(todo.length * 0.001).toFixed(2)})…\n`)

  let next = 0
  let done = 0
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const [hash, s] = todo[next++]!
      const q = questionByHash.get(hash) || '(market)'
      const user = `Market: ${q}\nHeadline risk: ${s.headlineRisk}\nAssumed vs actual: ${s.assumedVsActual ?? '(none stated)'}\nSummary: ${s.summary}`
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
        scores[hash] = s
        saveScores(scores)
        done++
        process.stdout.write(`  ${parsed.favors.padEnd(7)} ${q.slice(0, 54)}\n`)
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
