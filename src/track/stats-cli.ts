import { loadTrack, classifySurprise, edgeResult, isFlagged, processOutcome } from './store'
import { loadPairTrack } from './pairs'
import { wilson } from '../lib/stats'

// Regenerates every live-ledger number quoted in the README, from the local ledger.
//   npm run track:stats
// Free — reads local JSON, makes no API calls.

function main(): void {
  const t = loadTrack()
  const entries = Object.values(t)
  const settled = entries.filter((e) => e.settled)
  const first = entries.map((e) => e.snapshotAt).sort()[0]

  console.log('\n  LITMUS LIVE LEDGER\n')
  console.log(`  running since ${first?.slice(0, 10) ?? '—'} · snapshot ${new Date().toISOString().slice(0, 10)}`)
  console.log(`  ${entries.length} predictions locked · ${settled.length} settled · ${entries.length - settled.length} open\n`)

  // Edge paper trades, segmented by the rule generation that made the call.
  const byVer: Record<string, { w: number; l: number; pnl: number; open: number }> = {}
  for (const e of entries) {
    if (!e.edgeSide) continue
    const v = String(e.edgeVersion ?? 2)
    const b = (byVer[v] ??= { w: 0, l: 0, pnl: 0, open: 0 })
    const r = e.settled ? edgeResult(e) : null
    if (!r) {
      if (!e.settled) b.open++
      continue
    }
    if (r.result === 'win') b.w++
    else if (r.result === 'loss') b.l++
    b.pnl += r.pnl
  }
  console.log('  EDGES (1-unit paper trade, entered at the locked open-market price)')
  for (const [v, s] of Object.entries(byVer).sort()) {
    const label = v === '3' ? 'v3 (current rule)' : `v${v} (retired rule)`
    const decided = s.w + s.l
    console.log(
      `    ${label.padEnd(22)} ${s.w}W-${s.l}L  ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}u  ${s.open} open` +
        (decided < 20 ? `  (n=${decided} — below the n=20 reporting minimum)` : ''),
    )
  }

  // Risk calibration.
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  for (const e of settled) {
    const s = classifySurprise(e)
    if (!s || s === 'tossup') continue
    const f = isFlagged(e)
    if (f && s === 'surprise') tp++
    else if (f && s === 'clean') fp++
    else if (!f && s === 'surprise') fn++
    else tn++
  }
  console.log(`\n  CALIBRATION  ${tp} of ${tp + fn} surprises caught · ${fp} false alarms · n=${tp + fp + fn + tn} graded`)

  // Process outcomes — did settlement itself go sideways?
  const proc: Record<string, number> = {}
  for (const e of settled) {
    const p = processOutcome(e)
    if (p) proc[p] = (proc[p] ?? 0) + 1
  }
  console.log(`  PROCESS      ${Object.entries(proc).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

  // Crowd baseline: does the tool beat the market's own price?
  let n = 0
  let bc = 0
  let bl = 0
  for (const e of settled) {
    if (e.entryPriceYes == null || (e.outcome !== 'yes' && e.outcome !== 'no')) continue
    const y = e.outcome === 'yes' ? 1 : 0
    const p = e.entryPriceYes
    const adj = e.edgeSide === 'yes' ? p + 0.1 * (1 - p) : e.edgeSide === 'no' ? p - 0.1 * p : p
    bc += (p - y) ** 2
    bl += (adj - y) ** 2
    n++
  }
  if (n) {
    const crowd = bc / n
    const litmus = bl / n
    console.log(
      `  BRIER        crowd ${crowd.toFixed(4)} vs litmus ${litmus.toFixed(4)} (n=${n}) — ` +
        `${litmus < crowd ? 'Litmus ahead' : 'THE MARKET IS BEATING THE TOOL'}`,
    )
  }

  // Cross-venue pair ledger.
  const pt = Object.values(loadPairTrack()).filter((p) => p.leg)
  const ps = pt.filter((p) => p.settled)
  const splits = ps.filter((p) => p.settlement === 'split').length
  console.log(
    `\n  CROSS-VENUE  ${pt.length} leg pairs locked · ${ps.length} settled · ` +
      `${ps.filter((p) => p.settlement === 'identical').length} identical · ${splits} split`,
  )

  const graded = tp + fp + fn + tn
  if (graded >= 20) {
    const ci = wilson(tp, tp + fn)
    console.log(`\n  (recall ${tp}/${tp + fn}, 95% CI ${Math.round(ci.low * 100)}-${Math.round(ci.high * 100)}%)`)
  } else {
    console.log(`\n  Rates below n=20 are reported as counts, not percentages.`)
  }
  console.log('')
}

main()
