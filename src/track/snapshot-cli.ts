import { loadCatalog, loadScores } from '../cache/store'
import { edgeTag, STALE_HOURS } from '../../lib/litmus'
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

  let added = 0
  let skippedClosed = 0
  let skippedStale = 0
  for (const e of catalog) {
    const s = scores[e.rulebookHash]
    if (!s || track[e.rulebookHash]) continue
    // Don't lock a prediction on a market that has already resolved — the entry price
    // would be post-close (look-ahead). Only open markets get an honest entry.
    if (alreadyClosed(e.closeDate, now)) {
      skippedClosed++
      continue
    }
    // Don't lock an entry at a stale cached price either — if ingest failed, the live
    // market may have already converged, and a phantom dislocation would flatter the
    // paper P&L. The market locks on the next fresh ingest instead.
    const priceAge = e.priceAsOf ? (now - Date.parse(e.priceAsOf)) / 3_600_000 : null
    if (e.priceYes != null && priceAge != null && priceAge > STALE_HOURS) {
      skippedStale++
      continue
    }
    const edge = edgeTag(s.literalFavors, e.priceYes, s.leanConfidence, s.leanCrowdConsistent)
    track[e.rulebookHash] = {
      hash: e.rulebookHash,
      platform: e.platform,
      marketId: e.marketId,
      question: e.question,
      closeDate: e.closeDate,
      snapshotAt: new Date().toISOString(),
      combined: s.combined,
      band: s.band,
      headlineRisk: s.headlineRisk,
      edgeSide: edge ? edge.side : null,
      entryPriceYes: e.priceYes ?? null,
      settled: false,
      // Generation of the edge rule that made this call (3 = confidence + crowd-consistency
      // gated). Older locked entries keep their original edgeSide — a locked prediction is
      // never rewritten — but the record can be segmented by generation.
      edgeVersion: 3,
    }
    added++
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
