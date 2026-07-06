import { loadCatalog, loadScores } from '../cache/store'
import { lockPrediction } from './lock'
import { loadTrack, saveTrack, type Track } from './store'

// Lock a prediction for every scored market we aren't already tracking. Entry price
// is the price at first sight, so the paper-trade P&L is honest. Never overwrites an
// existing entry (the entry price must stay fixed). Free — no model calls.
//
// LOOK-AHEAD GUARD: we only lock predictions on markets that are still OPEN. Snapshotting
// an already-closed market would record a post-close "entry" price (often the settled
// price itself), which is look-ahead bias — the entry would already know the outcome. So
// closed markets are skipped, and any previously-tainted entry (locked after its close)
// is pruned.

/** True if the market's close date is known and already in the past. */
function alreadyClosed(closeDate: string | null, now: number): boolean {
  if (!closeDate) return false
  const t = Date.parse(closeDate)
  return Number.isFinite(t) && t <= now
}

/** Remove entries that were locked AFTER the market had already closed (look-ahead taint). */
function prune(track: Track): { kept: Track; removed: number } {
  const kept: Track = {}
  let removed = 0
  for (const [hash, e] of Object.entries(track)) {
    if (e.closeDate && Date.parse(e.snapshotAt) > Date.parse(e.closeDate)) {
      removed++
      continue
    }
    kept[hash] = e
  }
  return { kept, removed }
}

function main(): void {
  const catalog = loadCatalog()
  const scores = loadScores()
  const now = Date.now()

  const { kept: track, removed } = prune(loadTrack())

  // All locking invariants live in lockPrediction (src/track/lock.ts) — shared with
  // the fast-scan lane so the two lanes can never diverge or double-lock.
  let added = 0
  let skippedClosed = 0
  let skippedStale = 0
  for (const e of catalog) {
    const result = lockPrediction(e, scores[e.rulebookHash], track, now)
    if (result === 'locked') added++
    else if (result === 'closed') skippedClosed++
    else if (result === 'stale-price') skippedStale++
  }
  saveTrack(track)
  const total = Object.keys(track).length
  const notes = [
    removed ? `pruned ${removed} look-ahead-tainted` : '',
    skippedClosed ? `skipped ${skippedClosed} already-closed` : '',
    skippedStale ? `deferred ${skippedStale} stale-priced` : '',
  ]
    .filter(Boolean)
    .join(', ')
  console.log(
    `\n  Locked ${added} new prediction${added === 1 ? '' : 's'}. Tracking ${total} markets.` +
      (notes ? `\n  (${notes})` : '') +
      '\n',
  )
}

main()
