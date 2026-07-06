import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'
import { getConfig } from '../lib/env'
import { recordUsage, budgetAllows, confirmLargeRun, spendSummary } from '../lib/spend'
import { VerdictSchema, gateVerdict } from '../engine/verdict'
import { loadCatalog, loadScores, saveScores } from './store'
import { loadPairs, savePairs } from './pairs-store'

// Verdict backfill: one cheap pass deriving the 3-second layer from analyses we
// already paid for (input = the stored analysis, never the rulebook — no rescoring).
// Future scoring passes emit the verdict natively in the same call; this exists only
// for the back catalog. Cached by rulebook hash like everything else.
//
//   npm run verdicts            — fill in missing verdicts + pair split-shorts
//   npm run verdicts -- --force — re-derive all
const MODEL = process.env.LEAN_MODEL || 'claude-haiku-4-5'
const CONCURRENCY = 5

const SYSTEM = `You compress a finished prediction-market resolution-risk analysis into its 3-second verdict layer. You get the full analysis (headline risk, summary, per-dimension reasoning, quoted offending clauses, directional lean). Return:
- lean: which side the LITERAL rules favor for a casual holder (YES/NO/UNCLEAR). Base this on the analysis's own lean; UNCLEAR when it says neither or the tilt is weak.
- lean_confidence: 0-1.
- trap_phrase: <= 8 words naming the single most dangerous concept.
- killer_clause: the ONE worst clause — copied VERBATIM from the quoted clauses in the analysis. Never paraphrase; never invent. Null if no clause is quoted.
- so_what: <= 15 words a holder should understand.
The verdict may never claim more than the analysis supports.`

const PairShortSchema = z.object({ splits_if_short: z.string().nullable() })

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const catalog = loadCatalog()
  const rulesByHash = new Map(catalog.map((e) => [e.rulebookHash, e.resolutionText]))
  const scores = loadScores()

  const todo = Object.entries(scores).filter(([, s]) => force || !s.verdict)
  const pairs = loadPairs()
  const pairTodo = Object.values(pairs).filter(
    (p) => p.divergence && (force || p.divergence.splits_if_short === undefined),
  )

  if (!todo.length && !pairTodo.length) {
    console.log('\n  Every cached analysis already carries a verdict. ✓\n')
    return
  }
  if (!(await confirmLargeRun(todo.length + pairTodo.length, (todo.length + pairTodo.length) * 0.004, 'verdicts'))) return

  const cfg = getConfig()
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  console.log(
    `\n  Deriving verdicts for ${todo.length} analyses + ${pairTodo.length} pairs on ${MODEL} (~$${((todo.length + pairTodo.length) * 0.004).toFixed(2)})…\n`,
  )

  let next = 0
  let done = 0
  let unclear = 0
  async function worker(): Promise<void> {
    while (next < todo.length) {
      if (!budgetAllows().ok) {
        console.log(`  budget exhausted — deferring ${todo.length - next} verdicts.`)
        next = todo.length
        return
      }
      const [hash, s] = todo[next++]!
      const clauses = s.dimensions.map((d) => d.offendingClause).filter(Boolean) as string[]
      const user =
        `Headline risk: ${s.headlineRisk}\nSummary: ${s.summary}\nAssumed vs actual: ${s.assumedVsActual ?? '(none)'}\n` +
        `Directional lean: ${s.literalFavors ?? 'unknown'} (confidence ${s.leanConfidence ?? '—'}) — ${s.literalFavorsNote ?? ''}\n` +
        `Dimensions:\n${s.dimensions.map((d) => `- ${d.label} ${d.score}: ${d.reasoning}${d.offendingClause ? ` [clause: "${d.offendingClause}"]` : ''}`).join('\n')}`
      try {
        const res = await client.messages.parse({
          model: MODEL,
          max_tokens: 600,
          output_config: { format: zodOutputFormat(VerdictSchema) },
          system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
          messages: [{ role: 'user', content: user }],
        })
        recordUsage('verdict', MODEL, res.usage)
        if (!res.parsed_output) throw new Error('no structured output')
        // Gate against the rules text when we still have it, else the stored clauses.
        const sources = [rulesByHash.get(hash), ...clauses]
        const gated = gateVerdict(VerdictSchema.parse(res.parsed_output), sources)
        s.verdict = gated
        scores[hash] = s
        saveScores(scores)
        done++
        if (gated.lean === 'UNCLEAR') unclear++
        process.stdout.write(`  ${gated.lean.padEnd(8)} ${gated.trap_phrase.slice(0, 40).padEnd(42)} ${String(done).padStart(3)}/${todo.length}\n`)
      } catch (err) {
        process.stdout.write(`  err     ${hash} — ${err instanceof Error ? err.message : String(err)}\n`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(todo.length, 1)) }, () => worker()))

  // Pairs: compress the split scenario to <= 12 words.
  for (const p of pairTodo) {
    if (!budgetAllows().ok) break
    const d = p.divergence!
    if (!d.scenario_that_splits) {
      d.splits_if_short = null
      savePairs(pairs)
      continue
    }
    try {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 200,
        output_config: { format: zodOutputFormat(PairShortSchema) },
        system: 'Compress the split scenario to <= 12 words capturing the condition that splits the venues. Return null only if there is no scenario.',
        messages: [{ role: 'user', content: d.scenario_that_splits }],
      })
      recordUsage('verdict', MODEL, res.usage)
      d.splits_if_short = res.parsed_output ? PairShortSchema.parse(res.parsed_output).splits_if_short : null
      savePairs(pairs)
    } catch {
      /* stays undefined → retried next run */
    }
  }

  console.log(`\n  Verdicts: ${done} derived (${unclear} UNCLEAR after gating) · ${pairTodo.length} pair shorts. ${spendSummary()}.\n`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
