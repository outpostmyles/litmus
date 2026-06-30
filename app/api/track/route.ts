import { loadTrack, classifySurprise, edgeResult, isFlagged, type TrackEntry } from '@/src/track/store'
import { wilson } from '@/src/lib/stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Below this many decided cases we don't report a rate — a 2-0 record is noise, not a
 * track record. The UI shows a "building sample" state until the count crosses this.
 */
export const MIN_SAMPLE = 20

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
  for (const e of resolved) {
    const s = classifySurprise(e)
    if (s === null || s === 'tossup') continue
    const flagged = isFlagged(e)
    if (flagged && s === 'surprise') tp++
    else if (flagged && s === 'clean') fp++
    else if (!flagged && s === 'surprise') fn++
    else tn++
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

  const decided = wins + losses
  const recallN = tp + fn
  const precisionN = tp + fp
  const graded = tp + fp + fn + tn

  return Response.json({
    minSample: MIN_SAMPLE,
    counts: { tracked: entries.length, resolved: resolved.length, pending: pending.length },
    sim: {
      wins,
      losses,
      pushes,
      pnl,
      decided,
      winRate: decided ? wins / decided : null,
      winRateCI: decided ? wilson(wins, decided) : null,
      enoughSample: decided >= MIN_SAMPLE,
    },
    calibration: {
      tp,
      fp,
      fn,
      tn,
      graded,
      recall: recallN ? tp / recallN : null,
      recallN,
      recallCI: recallN ? wilson(tp, recallN) : null,
      precision: precisionN ? tp / precisionN : null,
      precisionN,
      precisionCI: precisionN ? wilson(tp, precisionN) : null,
      // Gate the recall RATE on recall's own denominator (the count of surprises), not on
      // total graded — else a matrix dominated by true-negatives would surface a recall
      // percentage computed from a handful of surprises. Same discipline as the edge tile,
      // which gates win-rate on `decided`.
      enoughSample: recallN >= MIN_SAMPLE,
    },
    resolvedRows,
    pendingRows,
  })
}
