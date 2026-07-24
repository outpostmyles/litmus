import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

// Spend ledger + budget enforcement. Every model call records its ACTUAL token
// usage and dollar cost here; scoring stages check the daily budget before each
// call and halt (logging what was deferred) when it's exhausted. The budget
// NEVER halts grading, locking, or settlement — those are free by construction.
export const SPEND_PATH = 'data/cache/spend.json'

/** Hard daily cap in USD. Scoring stops here; free stages are never affected. */
export function dailyBudgetUsd(): number {
  const raw = process.env.LITMUS_DAILY_BUDGET_USD
  if (raw == null || raw === '') return 10
  const v = Number(raw)
  // 0 is a valid hard stop ("spend nothing today"); only invalid/negative → default 10.
  return Number.isFinite(v) && v >= 0 ? v : 10
}

/** $/1M tokens by model family: [input, output]. Cache reads bill ~10% of input. */
const PRICES: [RegExp, [number, number]][] = [
  [/fable|mythos/, [10, 50]],
  [/opus/, [5, 25]],
  [/sonnet/, [3, 15]],
  [/haiku/, [1, 5]],
]

function priceFor(model: string): [number, number] {
  for (const [re, p] of PRICES) if (re.test(model)) return p
  return [5, 25] // unknown → price as opus, never undercount
}

export interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** Dollar cost of one call from its real usage block. */
export function costOf(model: string, u: UsageLike): number {
  const [inP, outP] = priceFor(model)
  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheWrite = u.cache_creation_input_tokens ?? 0
  return (
    (u.input_tokens * inP + cacheRead * inP * 0.1 + cacheWrite * inP * 1.25 + u.output_tokens * outP) / 1_000_000
  )
}

export interface StageRecord {
  usd: number
  calls: number
  inTok: number
  outTok: number
  /** Input tokens served from the prompt cache (billed at ~10%). */
  cacheRead?: number
  /** Input tokens written to the cache (billed at 1.25x). */
  cacheWrite?: number
}

export interface DayRecord {
  usd: number
  stages: Record<string, StageRecord>
}

type Ledger = Record<string, DayRecord> // key: YYYY-MM-DD

function loadLedger(): Ledger {
  if (!existsSync(SPEND_PATH)) return {}
  try {
    return JSON.parse(readFileSync(SPEND_PATH, 'utf8')) as Ledger
  } catch {
    // A corrupt spend ledger should not brick the pipeline — but say so loudly.
    console.warn('  spend ledger unreadable — starting a fresh one (old file left as .corrupt)')
    try {
      renameSync(SPEND_PATH, `${SPEND_PATH}.corrupt`)
    } catch {
      /* best effort */
    }
    return {}
  }
}

function saveLedger(l: Ledger): void {
  mkdirSync(dirname(SPEND_PATH), { recursive: true })
  const tmp = `${SPEND_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(l, null, 2))
  renameSync(tmp, SPEND_PATH)
}

const today = () => new Date().toISOString().slice(0, 10)

export function todayUsd(): number {
  return loadLedger()[today()]?.usd ?? 0
}

/** Trailing average daily spend over the previous `days` days (excluding today). */
export function trailingAvgUsd(days = 7): number {
  const l = loadLedger()
  const t = today()
  const past = Object.entries(l)
    .filter(([d]) => d < t)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, days)
  if (!past.length) return 0
  return past.reduce((s, [, r]) => s + r.usd, 0) / past.length
}

/**
 * Record one call's real usage. Returns the dollar cost. Prints a budget alert
 * when today crosses the cap or runs 3x above the trailing average.
 */
export function recordUsage(stage: string, model: string, u: UsageLike): number {
  const usd = costOf(model, u)
  const l = loadLedger()
  const d = (l[today()] ??= { usd: 0, stages: {} })
  const s = (d.stages[stage] ??= { usd: 0, calls: 0, inTok: 0, outTok: 0 })
  const before = d.usd
  d.usd += usd
  s.usd += usd
  s.calls += 1
  s.inTok += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  s.outTok += u.output_tokens
  s.cacheRead = (s.cacheRead ?? 0) + (u.cache_read_input_tokens ?? 0)
  s.cacheWrite = (s.cacheWrite ?? 0) + (u.cache_creation_input_tokens ?? 0)
  saveLedger(l)

  const budget = dailyBudgetUsd()
  if (before <= budget && d.usd > budget) {
    console.warn(`  ⚠ daily spend $${d.usd.toFixed(2)} has crossed the LITMUS_DAILY_BUDGET_USD cap ($${budget}) — scoring halts, grading continues.`)
  }
  const avg = trailingAvgUsd()
  if (avg > 0.5 && before <= 3 * avg && d.usd > 3 * avg) {
    console.warn(`  ⚠ today's spend $${d.usd.toFixed(2)} is >3x the trailing 7-day average ($${avg.toFixed(2)}/day).`)
  }
  return usd
}

/**
 * May a SCORING stage make its next paid call? Free stages never ask.
 * When false, callers stop scoring and log what was deferred.
 */
export function budgetAllows(): { ok: boolean; remaining: number } {
  const remaining = dailyBudgetUsd() - todayUsd()
  return { ok: remaining > 0, remaining: Math.max(0, remaining) }
}

/**
 * Cost-controls confirmation gate: any run scoring more than ~50 new items must
 * print its estimate and get an explicit yes — a TTY prompt interactively, or
 * `--yes` / LITMUS_YES=1 for unattended runs. Returns false when unconfirmed.
 */
export async function confirmLargeRun(count: number, estUsd: number, label: string): Promise<boolean> {
  if (count <= 50) return true
  const preapproved = process.argv.includes('--yes') || process.env.LITMUS_YES === '1'
  console.log(`\n  ${label}: ${count} items to score — estimated ~$${estUsd.toFixed(2)}.`)
  if (preapproved) {
    console.log('  (pre-approved via --yes / LITMUS_YES)')
    return true
  }
  if (!process.stdin.isTTY) {
    console.log('  >50 items needs explicit approval: re-run with --yes (or set LITMUS_YES=1). Aborting.')
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => rl.question('  Proceed? [y/N] ', resolve))
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

/** One-line ledger summary for run footers. */
export function spendSummary(): string {
  return `spend today $${todayUsd().toFixed(2)} of $${dailyBudgetUsd()} budget`
}
