import { loadPairTrack, savePairTrack, gradePairs, gradeLegPairs } from '../track/pairs'
import { acquireRunLock } from '../lib/runlock'
import { CROSSVENUE_LOCK } from './pairs-store'

// Free daily step: grade pair-ledger entries when both venues are final. Family
// entries compare outcomes already recorded (with provenance) by the main settle
// stage; LEG entries resolve their own marketIds directly through the same shared
// resolvers. Zero model calls — safe for the unattended daily job.
async function main(): Promise<void> {
  if (!acquireRunLock(CROSSVENUE_LOCK)) {
    console.log('\n  A crossvenue run is in progress — skipping pairs-settle this cycle.\n')
    return
  }
  const pairTrack = loadPairTrack()
  const total = Object.keys(pairTrack).length
  if (!total) {
    console.log('\n  No locked pairs yet — run npm run crossvenue after enrich.\n')
    return
  }
  const fam = gradePairs(pairTrack)
  const legs = await gradeLegPairs(pairTrack)
  const graded = fam.graded + legs.graded
  const splits = fam.splits + legs.splits
  savePairTrack(pairTrack)
  const settled = Object.values(pairTrack).filter((p) => p.settled)
  const splitAll = settled.filter((p) => p.settlement === 'split')

  // Visibility: pairs stuck pending long past both close dates can never grade
  // silently — same discipline as the main ledger's stuck warning.
  const STUCK_DAYS = 30
  const stuck = Object.values(pairTrack).filter((p) => {
    if (p.settled) return false
    const latest = [p.kalshi.closeDate, p.poly.closeDate]
      .map((d) => (d ? Date.parse(d) : NaN))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0]
    return latest != null && Date.now() - latest > STUCK_DAYS * 86_400_000
  })

  console.log(
    `\n  Pairs: ${total} locked · ${settled.length} settled (${splitAll.length} split) · ${graded} graded this run${splits ? ` — ${splits} NEW SPLIT SETTLEMENT${splits === 1 ? '' : 'S'} (the receipt!)` : ''}.`,
  )
  if (stuck.length) {
    console.log(`  ${stuck.length} pair${stuck.length === 1 ? '' : 's'} pending >${STUCK_DAYS}d past close — inspect manually.`)
  }
  console.log('')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
