import { writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../lib/env'
import { scoreMarket, type LitmusScore } from '../engine/score'
import { loadFixtures, isTextDetectable, type Fixture } from './fixtures'

/**
 * A market counts as "flagged" if its combined risk is at least this. 45 is the
 * "elevated" band boundary defined in src/engine/weights.ts (riskBand) — a cutoff set by
 * the scoring scale itself, NOT chosen to optimize this backtest. The live tracker
 * (src/track/store.ts isFlagged) uses the same 45, so the backtest and production agree
 * on what "flagged" means. The full threshold sweep below is printed so the choice is
 * auditable, not cherry-picked.
 */
const FLAG_THRESHOLD = 45
/**
 * A single dimension counts as "flagged" (the engine found that specific problem) at ≥50.
 * This is a deliberately STRICTER bar than the 45 market-level boundary: reason-precision
 * should only credit the engine for dimensions it flagged with clear conviction, not ones
 * that merely brushed the elevated line. Different question, so a different number.
 */
const DIM_FLAG = 50
/** How many markets to score at once. Each call uses adaptive thinking, so keep it modest. */
const CONCURRENCY = 4

interface CaseResult {
  fixture: Fixture
  score?: LitmusScore
  error?: string
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()))
  return results
}

function bar(score: number, width = 16): string {
  const filled = Math.round((score / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function pct(num: number, den: number): string {
  if (den === 0) return 'n/a'
  return `${Math.round((100 * num) / den)}%`
}

async function main(): Promise<void> {
  const fixtures = loadFixtures()
  if (fixtures.length === 0) {
    console.log(
      '\n  No backtest fixtures found in data/fixtures/backtest/.\n' +
        '  The gold-set is still being assembled — fixtures land there as one JSON file per case.\n',
    )
    return
  }

  let config
  try {
    config = getConfig()
  } catch (err) {
    console.log(`\n  ${err instanceof Error ? err.message : String(err)}\n`)
    return
  }

  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL })
  console.log(`\n  Litmus backtest — scoring ${fixtures.length} resolved markets blind (model ${config.model})\n`)

  const results: CaseResult[] = await mapPool(fixtures, CONCURRENCY, async (fixture) => {
    try {
      const score = await scoreMarket(fixture.market, { client })
      process.stdout.write(`  ✓ ${fixture.label.caseId} scored ${score.combined}\n`)
      return { fixture, score }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stdout.write(`  ✗ ${fixture.label.caseId} errored: ${message}\n`)
      return { fixture, error: message }
    }
  })

  const scored = results.filter((r): r is Required<Pick<CaseResult, 'fixture' | 'score'>> & CaseResult => !!r.score)

  // Per-case table
  console.log('\n  ' + '─'.repeat(78))
  console.log(`  ${'case'.padEnd(9)} ${'risk'.padStart(4)}  ${'band'.padEnd(9)} flag  detect   reason-hit`)
  console.log('  ' + '─'.repeat(78))
  for (const r of scored) {
    const s = r.score
    const expected = r.fixture.label.expectedDimensions
    const flaggedDims = new Set(s.dimensions.filter((d) => d.score >= DIM_FLAG).map((d) => d.key))
    const hits = expected.filter((d) => flaggedDims.has(d as never)).length
    const flagged = s.combined >= FLAG_THRESHOLD
    const detect = isTextDetectable(r.fixture) ? 'text' : 'ctrl'
    console.log(
      `  ${r.fixture.label.caseId.padEnd(9)} ${String(s.combined).padStart(4)}  ${s.band.padEnd(9)} ` +
        `${flagged ? ' * ' : '   '}  ${detect.padEnd(6)} ${expected.length ? `${hits}/${expected.length}` : '—'}`,
    )
  }
  console.log('  ' + '─'.repeat(78))

  // Aggregate metrics
  const detect = scored.filter((r) => isTextDetectable(r.fixture))
  const control = scored.filter((r) => !isTextDetectable(r.fixture))

  // Threshold sweep: how recall (on detectable disputes) and the control case move with the cutoff.
  const THRESHOLDS = [45, 50, 60, 65]
  console.log('\n  RECALL BY THRESHOLD  (a market is "flagged" if combined risk ≥ T)')
  console.log(`  ${'T'.padStart(4)}   ${'detectable disputes'.padEnd(20)} ${'control'.padEnd(9)} all`)
  for (const T of THRESHOLDS) {
    const d = detect.filter((r) => r.score.combined >= T).length
    const c = control.filter((r) => r.score.combined >= T).length
    const a = scored.filter((r) => r.score.combined >= T).length
    const mark = T === FLAG_THRESHOLD ? ' ←' : ''
    console.log(
      `  ${('≥' + T).padStart(4)}   ${`${d}/${detect.length}  (${pct(d, detect.length)})`.padEnd(20)} ${`${c}/${control.length}`.padEnd(9)} ${a}/${scored.length}${mark}`,
    )
  }

  const meanDetect = detect.length ? Math.round(detect.reduce((s, r) => s + r.score.combined, 0) / detect.length) : 0
  const meanControl = control.length ? Math.round(control.reduce((s, r) => s + r.score.combined, 0) / control.length) : 0

  // Reason precision: did the engine flag the SPECIFIC dimensions each dispute is known for?
  // Reported two ways — over ALL scored cases (threshold-independent), and over only the
  // markets flagged at FLAG_THRESHOLD (so the "on flagged" figure tracks the same 45 cutoff
  // used everywhere else, instead of drifting onto a stale threshold).
  let dimNum = 0
  let dimDen = 0
  let dimNumFlagged = 0
  let dimDenFlagged = 0
  for (const r of scored) {
    const flaggedDims = new Set(r.score.dimensions.filter((d) => d.score >= DIM_FLAG).map((d) => d.key))
    const marketFlagged = r.score.combined >= FLAG_THRESHOLD
    for (const d of r.fixture.label.expectedDimensions) {
      dimDen += 1
      const hit = flaggedDims.has(d as never)
      if (hit) dimNum += 1
      if (marketFlagged) {
        dimDenFlagged += 1
        if (hit) dimNumFlagged += 1
      }
    }
  }

  console.log(
    `\n  Mean risk — detectable disputes: ${meanDetect}   control: ${meanControl}   (separation = ${meanDetect - meanControl})`,
  )
  console.log(
    `  Reason precision: engine independently flagged ${dimNum}/${dimDen} (${pct(dimNum, dimDen)}) of the dimensions each dispute is known for` +
      ` — ${dimNumFlagged}/${dimDenFlagged} (${pct(dimNumFlagged, dimDenFlagged)}) on the markets it flagged (≥${FLAG_THRESHOLD})`,
  )
  if (results.some((r) => r.error)) {
    console.log(`  ${results.filter((r) => r.error).length} case(s) errored and were excluded.`)
  }

  // Durable artifact: full per-case results (every dimension score) for auditing/repro.
  const artifact = {
    ranAt: new Date().toISOString(),
    model: config.model,
    flagThreshold: FLAG_THRESHOLD,
    dimFlag: DIM_FLAG,
    summary: {
      total: scored.length,
      detectable: detect.length,
      control: control.length,
      meanDetect,
      meanControl,
      reasonPrecision: { hit: dimNum, of: dimDen, onFlagged: { hit: dimNumFlagged, of: dimDenFlagged } },
      recallByThreshold: THRESHOLDS.map((T) => ({
        threshold: T,
        detectable: detect.filter((r) => r.score.combined >= T).length,
        control: control.filter((r) => r.score.combined >= T).length,
      })),
    },
    cases: scored.map((r) => ({
      caseId: r.fixture.label.caseId,
      platform: r.fixture.market.platform,
      marketTitle: r.fixture.label.marketTitle,
      textDetectable: r.fixture.label.textDetectable,
      combined: r.score.combined,
      band: r.score.band,
      dimensions: r.score.dimensions.map((d) => ({ key: d.key, score: d.score })),
      expectedDimensions: r.fixture.label.expectedDimensions,
    })),
  }
  writeFileSync('data/backtest-results.json', JSON.stringify(artifact, null, 2))
  console.log('  (full per-case results written to data/backtest-results.json)')
  console.log('')
}

main().catch((err: unknown) => {
  console.error(`\n  Backtest error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
