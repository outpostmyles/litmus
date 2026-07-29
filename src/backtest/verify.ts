import { readFileSync } from 'node:fs'
import { wilson } from '../lib/stats'
import { loadFixtures, isTextDetectable } from './fixtures'

// Offline verification of the published backtest — NO API KEY, NO MODEL CALLS.
// Recomputes every headline number from two committed sources:
//   data/backtest-results.json  (the recorded per-case scores from the blind run)
//   data/fixtures/backtest/*    (the 13 fixtures, whose labels the engine never saw)
// A reviewer can confirm the README's claims in one command:  npm run verify
//
// This checks arithmetic and internal consistency, not that the model would produce
// the same scores again (LLM output is stochastic — see docs/BACKTEST.md).

interface ArtifactCase {
  caseId: string
  combined: number
  band: string
  textDetectable: string
  dimensions: { key: string; score: number }[]
  expectedDimensions: string[]
}

const FLAG = 45 // pre-registered: the "elevated" band boundary in src/engine/weights.ts
const DIM_FLAG = 50

function main(): void {
  const artifact = JSON.parse(readFileSync('data/backtest-results.json', 'utf8'))
  const cases: ArtifactCase[] = artifact.cases
  const fixtures = loadFixtures()

  console.log('\n  VERIFYING THE PUBLISHED BACKTEST (offline — no API key, no model calls)\n')

  // 1. Every scored case must correspond to a committed fixture.
  const fixtureIds = new Set(fixtures.map((f) => f.label.caseId))
  const orphans = cases.filter((c) => !fixtureIds.has(c.caseId))
  console.log(`  fixtures on disk: ${fixtures.length} · cases in artifact: ${cases.length} · unmatched: ${orphans.length}`)

  // 2. Recompute the recall table from per-case scores.
  const detect = cases.filter((c) => {
    const f = fixtures.find((x) => x.label.caseId === c.caseId)
    return f ? isTextDetectable(f) : c.textDetectable.toUpperCase() !== 'WEAK'
  })
  const control = cases.filter((c) => !detect.includes(c))

  console.log(`\n  ${'T'.padStart(5)}   detectable disputes flagged      control flagged`)
  for (const T of [45, 50, 60, 65]) {
    const d = detect.filter((c) => c.combined >= T).length
    const ct = control.filter((c) => c.combined >= T).length
    const ci = wilson(d, detect.length)
    const mark = T === FLAG ? '  <- pre-registered' : ''
    console.log(
      `  ${('>=' + T).padStart(5)}   ${d}/${detect.length} = ${Math.round((100 * d) / detect.length)}% (95% CI ${Math.round(ci.low * 100)}-${Math.round(ci.high * 100)}%)   ${ct}/${control.length}${mark}`,
    )
  }

  // 3. Mean separation.
  const mean = (xs: ArtifactCase[]) => Math.round(xs.reduce((s, c) => s + c.combined, 0) / xs.length)
  const md = mean(detect)
  const mc = mean(control)
  console.log(`\n  mean risk — disputes ${md} vs control ${mc}  (separation ${md - mc})`)

  // 4. Reason precision: did it flag the dimensions each dispute is known for?
  let hit = 0
  let of = 0
  for (const c of cases) {
    const flagged = new Set(c.dimensions.filter((d) => d.score >= DIM_FLAG).map((d) => d.key))
    for (const d of c.expectedDimensions) {
      of++
      if (flagged.has(d)) hit++
    }
  }
  console.log(`  reason precision — ${hit}/${of} (${Math.round((100 * hit) / of)}%) of known failure dimensions independently flagged`)

  // 5. Blindness check: no fixture's answer key may appear in what the engine was fed.
  let leaks = 0
  for (const f of fixtures) {
    const seen = JSON.stringify(f.market).toLowerCase()
    const tell = (f.label.whatHappened || '').toLowerCase().slice(0, 40)
    if (tell && seen.includes(tell)) leaks++
  }
  console.log(`  blindness — fixtures whose scored input contains the outcome narrative: ${leaks} (must be 0)`)

  const recall45 = detect.filter((c) => c.combined >= FLAG).length
  const ci45 = wilson(recall45, detect.length)
  console.log(
    `\n  HEADLINE: recall ${recall45}/${detect.length} = ${Math.round((100 * recall45) / detect.length)}% ` +
      `(95% CI ${Math.round(ci45.low * 100)}-${Math.round(ci45.high * 100)}%) at threshold >=${FLAG}, ` +
      `control ${control.filter((c) => c.combined >= FLAG).length}/${control.length} flagged.`,
  )
  console.log('  Compare against README.md and docs/BACKTEST.md — the numbers should match.\n')
}

main()
