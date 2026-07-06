import { loadTrack, saveTrack } from './store'
import { resolveKalshi, resolvePolymarket, isInFlight } from './resolve'

// Check open tracked markets for resolution and record the outcome. Free — read-only
// API calls. Run daily; it settles markets as they close.
//
// GRADING INTEGRITY: an entry is settled only when the platform says the market is
// genuinely FINAL — enforced by the shared resolvers (src/track/resolve.ts), which the
// pair-leg grader also uses; anything ambiguous stays pending or surfaces as in-flight
// dispute evidence.
const CONCURRENCY = 5

async function main(): Promise<void> {
  const track = loadTrack()
  const pending = Object.values(track).filter((e) => !e.settled)
  if (!pending.length) {
    console.log('\n  Nothing to settle — no open tracked markets.\n')
    return
  }
  console.log(`\n  Checking ${pending.length} open tracked markets for resolution…\n`)

  let next = 0
  let settled = 0
  let disputes = 0
  async function worker(): Promise<void> {
    while (next < pending.length) {
      const e = pending[next++]!
      const res = e.platform === 'Kalshi' ? await resolveKalshi(e.marketId) : await resolvePolymarket(e.marketId)
      if (!res) continue
      const t = track[e.hash]
      if (!t) continue
      if (isInFlight(res)) {
        // Not final — record the dispute evidence once and keep the entry pending.
        if (!t.disputeSeen) {
          t.disputeSeen = `${res.note} ${new Date().toISOString().slice(0, 10)}`
          saveTrack(track)
          disputes++
          console.log(`  DISPUTED (pending)  ${e.question.slice(0, 48)}  [${res.note}]`)
        }
        continue
      }
      t.settled = true
      t.outcome = res.outcome
      t.finalPriceYes = res.finalPriceYes
      t.resolvedAt = new Date().toISOString()
      t.resolvedVia = res.via
      saveTrack(track)
      settled++
      console.log(`  ${res.outcome.toUpperCase().padEnd(5)} ${e.question.slice(0, 56)}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()))

  const totalResolved = Object.values(track).filter((e) => e.settled).length
  console.log(
    `\n  Settled ${settled} this run${disputes ? ` (+${disputes} live dispute${disputes === 1 ? '' : 's'} recorded)` : ''}. ${totalResolved} resolved total.`,
  )

  // Visibility on entries the resolver can't finalize (delisted market, oracle limbo):
  // they stay conservatively pending, but silence would let them pile up unnoticed.
  const STUCK_DAYS = 30
  const stuck = Object.values(track).filter(
    (e) => !e.settled && e.closeDate && Date.now() - Date.parse(e.closeDate) > STUCK_DAYS * 86_400_000,
  )
  if (stuck.length) {
    console.log(`  ${stuck.length} entr${stuck.length === 1 ? 'y' : 'ies'} still pending >${STUCK_DAYS}d past close — inspect manually:`)
    for (const e of stuck.slice(0, 5)) console.log(`     ${e.platform} ${e.marketId}  ${e.question.slice(0, 48)}`)
  }
  console.log('')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
