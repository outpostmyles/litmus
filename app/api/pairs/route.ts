import { loadCatalog } from '@/src/cache/store'
import { loadPairs } from '@/src/cache/pairs-store'
import { loadPairTrack } from '@/src/track/pairs'
import { pairRisk } from '@/src/engine/crossvenue/pairRisk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  const catalog = loadCatalog()
  const byHash = new Map(catalog.map((e) => [e.rulebookHash, e]))
  const pairs = loadPairs()
  const ledger = loadPairTrack()

  // Leg entries are keyed `${pairKey}#label`; index settled ones by their parent so
  // fan-out families surface their per-leg grades (the family key has no ledger row).
  const legSettlementsByParent = new Map<string, { label: string; settlement?: string; kalshi?: string; poly?: string }[]>()
  for (const e of Object.values(ledger)) {
    if (!e.leg || !e.settled) continue
    const arr = legSettlementsByParent.get(e.leg.parentPairKey) ?? []
    arr.push({ label: e.leg.label, settlement: e.settlement, kalshi: e.kalshiOutcome, poly: e.polyOutcome })
    legSettlementsByParent.set(e.leg.parentPairKey, arr)
  }

  // Only ACTIVE pairs render (both rulebooks in the current catalog) — counts and
  // rows come from the same set so the header never claims more than is shown.
  const rows = Object.values(pairs)
    .filter((p) => p.active && p.divergence && (p.match?.same_event === 'yes' || p.match?.same_event === 'partial'))
    .map((p) => {
      const k = byHash.get(p.kalshiHash)
      const m = byHash.get(p.polyHash)
      const kPrice = k?.priceYes ?? null
      const mPrice = m?.priceYes ?? null
      const { risk, base, gap } = pairRisk(p.divergence!, kPrice, mPrice)
      const tracked = ledger[p.pairKey] ?? null
      const legGrades = legSettlementsByParent.get(p.pairKey) ?? []
      const legSplits = legGrades.filter((g) => g.settlement === 'split').length
      return {
        pairKey: p.pairKey,
        sameEvent: p.match!.same_event,
        risk,
        base,
        gap,
        scenario: p.divergence!.scenario_that_splits,
        scenarioYesVenue: p.divergence!.scenario_yes_venue,
        splitsIfShort: p.divergence!.splits_if_short ?? null,
        legPairs: (p.legPairs ?? [])
          .slice()
          .sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1))
          .slice(0, 20)
          // Attach any settlement grade to each rendered leg.
          .map((lp) => {
            const g = legGrades.find((x) => x.label === lp.label)
            return g ? { ...lp, settlement: g.settlement, outcomes: { kalshi: g.kalshi, poly: g.poly } } : lp
          }),
        legSettled: legGrades.length,
        legSplits,
        summary: p.divergence!.summary,
        items: p.divergence!.items,
        kalshi: k
          ? { question: k.question, priceYes: kPrice, closeDate: k.closeDate, url: k.url, marketId: k.marketId }
          : null,
        poly: m
          ? { question: m.question, priceYes: mPrice, closeDate: m.closeDate, url: m.url, marketId: m.marketId }
          : null,
        // Row-level settlement: family entry if present, else derived from legs.
        settlement: tracked?.settled ? tracked.settlement : legSplits > 0 ? 'split' : null,
        outcomes: tracked?.settled ? { kalshi: tracked.kalshiOutcome, poly: tracked.polyOutcome } : null,
      }
    })
    .sort((a, b) => b.risk - a.risk)

  const awaitingDivergence = Object.values(pairs).filter(
    (p) => p.active && (p.match?.same_event === 'yes' || p.match?.same_event === 'partial') && !p.divergence,
  ).length
  const settledPairs = Object.values(ledger).filter((p) => p.settled)
  const dataAsOf = catalog.reduce<string | null>((acc, e) => (!acc || e.fetchedAt > acc ? e.fetchedAt : acc), null)

  return Response.json({
    rows,
    counts: {
      confirmed: rows.length,
      sameEvent: rows.filter((r) => r.sameEvent === 'yes').length,
      partial: rows.filter((r) => r.sameEvent === 'partial').length,
      awaitingDivergence,
      settled: settledPairs.length,
      splits: settledPairs.filter((p) => p.settlement === 'split').length,
    },
    dataAsOf,
  })
}
