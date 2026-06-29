import { loadCatalog, loadScores } from '../cache/store'
import { edgeTag } from '../../lib/litmus'
import { loadTrack, saveTrack } from './store'

// Lock a prediction for every scored market we aren't already tracking. Entry price
// is the price at first sight, so the paper-trade P&L is honest. Never overwrites an
// existing entry (the entry price must stay fixed). Free — no model calls.
function main(): void {
  const catalog = loadCatalog()
  const scores = loadScores()
  const track = loadTrack()

  let added = 0
  for (const e of catalog) {
    const s = scores[e.rulebookHash]
    if (!s || track[e.rulebookHash]) continue
    const edge = edgeTag(s.literalFavors, e.priceYes)
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
    }
    added++
  }
  saveTrack(track)
  const total = Object.keys(track).length
  console.log(`\n  Locked ${added} new prediction${added === 1 ? '' : 's'}. Tracking ${total} markets.\n`)
}

main()
