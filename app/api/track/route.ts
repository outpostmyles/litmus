import { loadTrack, classifySurprise, edgeResult, isFlagged, processOutcome, type TrackEntry } from '@/src/track/store'
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
    disputeSeen: e.disputeSeen ?? null,
    process: processOutcome(e),
  }
}

/** Entry prices where a surprise is even possible — beyond this the crowd has decided. */
const GRADEABLE_LOW = 0.1
const GRADEABLE_HIGH = 0.9

function isMidPriced(e: TrackEntry): boolean {
  return e.entryPriceYes != null && e.entryPriceYes >= GRADEABLE_LOW && e.entryPriceYes <= GRADEABLE_HIGH
}

export function GET() {
  const entries = Object.values(loadTrack())
  const resolved = entries.filter((e) => e.settled)
  const pending = entries.filter((e) => !e.settled)

  // Edge simulation (paper trades on the rules-favored side), SEGMENTED by the edge
  // rule that made the call. Locked predictions are never rewritten, so the record
  // still carries v2 calls made by the old rule (which minted penny lotteries the
  // accuracy audit diagnosed). Reporting them together would judge the fixed rule on
  // the broken rule's losses — and would also let a good v3 hide behind a bad v2.
  const blank = () => ({ wins: 0, losses: 0, pushes: 0, pnl: 0 })
  const byVersion: Record<string, ReturnType<typeof blank>> = {}
  let wins = 0
  let losses = 0
  let pushes = 0
  let pnl = 0
  for (const e of resolved) {
    const er = edgeResult(e)
    if (!er) continue
    const v = String(e.edgeVersion ?? 2)
    const bucket = (byVersion[v] ??= blank())
    if (er.result === 'win') {
      wins++
      bucket.wins++
    } else if (er.result === 'loss') {
      losses++
      bucket.losses++
    } else {
      pushes++
      bucket.pushes++
    }
    pnl += er.pnl
    bucket.pnl += er.pnl
  }
  // Pending edges per generation — how much of the record is still the old rule.
  const pendingByVersion: Record<string, number> = {}
  for (const e of pending) {
    if (!e.edgeSide) continue
    const v = String(e.edgeVersion ?? 2)
    pendingByVersion[v] = (pendingByVersion[v] ?? 0) + 1
  }

  // Risk calibration (did flagged markets actually surprise?), split by whether the
  // entry price even allowed a surprise: a market locked at 0.5¢ cannot flip, so
  // grading a flag against it says nothing about the analysis.
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  let gradedMid = 0
  let gradedExtreme = 0
  for (const e of resolved) {
    const s = classifySurprise(e)
    if (s === null || s === 'tossup') continue
    if (isMidPriced(e)) gradedMid++
    else gradedExtreme++
    const flagged = isFlagged(e)
    if (flagged && s === 'surprise') tp++
    else if (flagged && s === 'clean') fp++
    else if (!flagged && s === 'surprise') fn++
    else tn++
  }

  // PROCESS calibration — the tool's actual claim. Did resolution go sideways
  // (dispute, void, split, long delay), and were those markets the flagged ones?
  const proc = { flagged: { sideways: 0, clean: 0 }, unflagged: { sideways: 0, clean: 0 } }
  let liveDisputes = 0
  for (const e of resolved) {
    const p = processOutcome(e)
    if (!p) continue
    const bucket = isFlagged(e) ? proc.flagged : proc.unflagged
    if (p === 'clean') bucket.clean++
    else bucket.sideways++
  }
  for (const e of pending) if (e.disputeSeen) liveDisputes++

  // Crowd baseline: Brier of the locked entry price alone, vs the entry price shifted
  // 10% toward the rules-favored side wherever an edge was locked. The falsifiable
  // "does Litmus add information?" test — stated formula, computed only on yes/no
  // outcomes with a locked entry.
  let brierN = 0
  let brierCrowd = 0
  let brierLitmus = 0
  for (const e of resolved) {
    if (e.entryPriceYes == null || (e.outcome !== 'yes' && e.outcome !== 'no')) continue
    const y = e.outcome === 'yes' ? 1 : 0
    const p = e.entryPriceYes
    const adj = e.edgeSide === 'yes' ? p + 0.1 * (1 - p) : e.edgeSide === 'no' ? p - 0.1 * p : p
    brierCrowd += (p - y) ** 2
    brierLitmus += (adj - y) ** 2
    brierN++
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
      /** Per-rule-generation record. v2 = the old rule (minted penny lotteries);
       *  v3 = confidence + crowd-consistency gated. Locked calls are never rewritten,
       *  so the two must be judged separately. */
      byVersion,
      pendingByVersion,
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
      gradedMid,
      gradedExtreme,
    },
    process: {
      ...proc,
      liveDisputes,
    },
    baseline:
      brierN > 0
        ? {
            n: brierN,
            crowd: brierCrowd / brierN,
            litmus: brierLitmus / brierN,
          }
        : null,
    resolvedRows,
    pendingRows,
  })
}
