import { loadTrack, classifySurprise, edgeResult, isFlagged, type TrackEntry } from '@/src/track/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function rowOf(e: TrackEntry) {
  return {
    hash: e.hash,
    platform: e.platform,
    question: e.question,
    combined: e.combined,
    band: e.band,
    edgeSide: e.edgeSide,
    entryPriceYes: e.entryPriceYes,
    closeDate: e.closeDate,
    outcome: e.outcome ?? null,
    finalPriceYes: e.finalPriceYes ?? null,
    resolvedAt: e.resolvedAt ?? null,
  }
}

export function GET() {
  const entries = Object.values(loadTrack())
  const resolved = entries.filter((e) => e.settled)
  const pending = entries.filter((e) => !e.settled)

  // Edge simulation (paper trades on the rules-favored side)
  let wins = 0
  let losses = 0
  let pushes = 0
  let pnl = 0
  for (const e of resolved) {
    const er = edgeResult(e)
    if (!er) continue
    if (er.result === 'win') wins++
    else if (er.result === 'loss') losses++
    else pushes++
    pnl += er.pnl
  }

  // Risk calibration (did flagged markets actually surprise?)
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  const bandStats: Record<string, { surprise: number; total: number }> = {}
  for (const e of resolved) {
    const s = classifySurprise(e)
    if (s === null || s === 'tossup') continue
    const flagged = isFlagged(e)
    if (flagged && s === 'surprise') tp++
    else if (flagged && s === 'clean') fp++
    else if (!flagged && s === 'surprise') fn++
    else tn++
    const bs = bandStats[e.band] ?? { surprise: 0, total: 0 }
    bs.total++
    if (s === 'surprise') bs.surprise++
    bandStats[e.band] = bs
  }

  const resolvedRows = resolved
    .map((e) => ({ ...rowOf(e), surprise: classifySurprise(e), edge: edgeResult(e) }))
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))

  const pendingRows = pending
    .map(rowOf)
    .sort(
      (a, b) =>
        (a.closeDate ? new Date(a.closeDate).getTime() : Infinity) -
        (b.closeDate ? new Date(b.closeDate).getTime() : Infinity),
    )

  return Response.json({
    counts: { tracked: entries.length, resolved: resolved.length, pending: pending.length },
    sim: { wins, losses, pushes, pnl, decided: wins + losses, winRate: wins + losses ? wins / (wins + losses) : null },
    calibration: {
      tp,
      fp,
      fn,
      tn,
      recall: tp + fn ? tp / (tp + fn) : null,
      precision: tp + fp ? tp / (tp + fp) : null,
      bandStats,
    },
    resolvedRows,
    pendingRows,
  })
}
