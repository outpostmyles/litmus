import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../lib/env'
import { budgetAllows, confirmLargeRun, spendSummary } from '../lib/spend'
import { acquireRunLock } from '../lib/runlock'
import { STALE_HOURS } from '../../lib/litmus'
import { loadCatalog, type CatalogEntry } from './store'
import { loadPairs, savePairs, pairKey, CROSSVENUE_LOCK, type PairRecord } from './pairs-store'
import { generateCandidates, type CandidateMarket } from '../engine/crossvenue/candidates'
import { confirmMatch, type MarketBrief } from '../engine/crossvenue/matchConfirm'
import { scoreDivergence } from '../engine/crossvenue/divergenceScore'
import { baseDivergence, pairRisk } from '../engine/crossvenue/pairRisk'
import { matchLegs, type Leg } from '../engine/crossvenue/legs'
import { tryGetJson } from '../lib/http'
import { loadTrack } from '../track/store'
import { loadPairTrack, savePairTrack, gradePairs } from '../track/pairs'

// Cross-venue pipeline stage. Runs after `enrich`. Incremental and idempotent:
// candidate generation is free and re-runs fully; the two LLM stages are cached by
// pair key and never re-pay for a pair. Run caps keep any single run's spend bounded.
//
//   npm run crossvenue             — process new pairs, grade settled ones
//   npm run crossvenue -- --report — also print the ranked pair report

const THRESHOLD = Number(process.env.CROSSVENUE_THRESHOLD || '0.3')
const WINDOW_DAYS = Number(process.env.CROSSVENUE_WINDOW_DAYS || '60')
const MAX_CONFIRM = Number(process.env.CROSSVENUE_MAX_CONFIRM || '200')
const MAX_DIVERGE = Number(process.env.CROSSVENUE_MAX_DIVERGE || '40')
const MATCH_MODEL = process.env.CROSSVENUE_MATCH_MODEL || 'claude-haiku-4-5'
const CONCURRENCY = 4

// Rough per-call cost estimates for the run report (input-heavy calls).
const EST_CONFIRM_COST = 0.01
const EST_DIVERGE_COST = 0.12

function toCandidate(e: CatalogEntry): CandidateMarket {
  return {
    rulebookHash: e.rulebookHash,
    platform: e.platform,
    question: e.question,
    category: e.category,
    closeDate: e.closeDate,
    priceYes: e.priceYes,
  }
}

function brief(e: CatalogEntry): MarketBrief {
  return { question: e.question, rules: e.resolutionText, closeDate: e.closeDate }
}

async function mapPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) await fn(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()))
}

async function main(): Promise<void> {
  if (!acquireRunLock(CROSSVENUE_LOCK)) {
    console.log('\n  Another crossvenue/pairs run is in progress — exiting to protect the cache.\n')
    return
  }
  const report = process.argv.includes('--report')
  const catalog = loadCatalog()
  const byHash = new Map(catalog.map((e) => [e.rulebookHash, e]))
  const kalshi = catalog.filter((e) => e.platform === 'Kalshi').map(toCandidate)
  const poly = catalog.filter((e) => e.platform === 'Polymarket').map(toCandidate)

  const pairs = loadPairs()

  // 1. Candidate generation — free, deterministic, full re-run each time.
  const candidates = generateCandidates(kalshi, poly, { threshold: THRESHOLD, closeWindowDays: WINDOW_DAYS })
  let discovered = 0
  for (const c of candidates) {
    const key = pairKey(c.kalshiHash, c.polyHash)
    if (!pairs[key]) {
      pairs[key] = {
        pairKey: key,
        kalshiHash: c.kalshiHash,
        polyHash: c.polyHash,
        candidateScore: c.score,
        discoveredAt: new Date().toISOString(),
        active: true,
      }
      discovered++
    }
  }
  // Refresh active flags; paid analysis is kept even when a market leaves the catalog.
  for (const p of Object.values(pairs)) {
    p.active = byHash.has(p.kalshiHash) && byHash.has(p.polyHash)
  }
  savePairs(pairs)
  console.log(
    `\n  Cross-venue: ${kalshi.length}×${poly.length} markets → ${candidates.length} candidates (threshold ${THRESHOLD}), ${discovered} new.`,
  )

  // 2+3. LLM stages — cached by pair key, capped per run. Client + key are only
  // required when there is actual LLM work: a fully-cached run (lock, grade,
  // report) stays key-free like the rest of the free pipeline.
  const needConfirm = Object.values(pairs)
    .filter((p) => p.active && !p.match)
    .sort((a, b) => b.candidateScore - a.candidateScore)
    .slice(0, MAX_CONFIRM)
  let client: Anthropic | null = null
  let engineModel = ''
  const getClient = () => {
    if (!client) {
      const cfg = getConfig()
      engineModel = cfg.model
      client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
    }
    return client
  }

  if (needConfirm.length) {
    if (!(await confirmLargeRun(needConfirm.length, needConfirm.length * EST_CONFIRM_COST, 'crossvenue match'))) return
    console.log(`  Confirming ${needConfirm.length} pairs on ${MATCH_MODEL} (~$${(needConfirm.length * EST_CONFIRM_COST).toFixed(2)})…`)
    await mapPool(needConfirm, CONCURRENCY, async (p) => {
      if (!budgetAllows().ok) return // deferred to a later run — pair stays uncached
      const k = byHash.get(p.kalshiHash)
      const m = byHash.get(p.polyHash)
      if (!k || !m) return
      try {
        const res = await confirmMatch(getClient(), MATCH_MODEL, brief(k), brief(m))
        p.match = { ...res, model: MATCH_MODEL, checkedAt: new Date().toISOString() }
        savePairs(pairs)
        console.log(`   ${res.same_event.padEnd(8)} ${k.question.slice(0, 34)} ↔ ${m.question.slice(0, 34)}`)
      } catch (err) {
        console.log(`   err      ${k.question.slice(0, 40)} — ${err instanceof Error ? err.message : err}`)
      }
    })
  }

  const needDiverge = Object.values(pairs)
    .filter((p) => p.active && (p.match?.same_event === 'yes' || p.match?.same_event === 'partial') && !p.divergence)
    .sort((a, b) => (b.match?.confidence ?? 0) - (a.match?.confidence ?? 0))
    .slice(0, MAX_DIVERGE)

  if (needDiverge.length) {
    getClient()
    console.log(`\n  Divergence-scoring ${needDiverge.length} confirmed pairs on ${engineModel} (~$${(needDiverge.length * EST_DIVERGE_COST).toFixed(2)})…`)
    await mapPool(needDiverge, CONCURRENCY, async (p) => {
      if (!budgetAllows().ok) return // deferred — stays uncached for the next run
      const k = byHash.get(p.kalshiHash)
      const m = byHash.get(p.polyHash)
      if (!k || !m) return
      try {
        const res = await scoreDivergence(getClient(), engineModel, brief(k), brief(m))
        p.divergence = { ...res, model: engineModel, scoredAt: new Date().toISOString() }
        savePairs(pairs)
        const base = baseDivergence(res)
        console.log(`   div ${String(base).padStart(3)}  ${k.question.slice(0, 32)} ↔ ${m.question.slice(0, 32)}`)
      } catch (err) {
        console.log(`   err      ${k.question.slice(0, 40)} — ${err instanceof Error ? err.message : err}`)
      }
    })
  }

  // 4. Lock pair-ledger entries — only pairs the ledger can honestly GRADE:
  //    both legs open, 1×1 (no fan-out groups: a group's outcome is an arbitrary
  //    representative's outcome), present-and-unsettled in the main ledger, and
  //    priced fresh (a stale price fabricates a phantom gap, same rationale as
  //    snapshot-cli).
  const pairTrack = loadPairTrack()
  const track = loadTrack()
  const now = Date.now()
  const stillOpen = (e: CatalogEntry) => {
    if (!e.closeDate) return true
    const t = Date.parse(e.closeDate)
    return !Number.isFinite(t) || t > now
  }
  const fresh = (e: CatalogEntry) =>
    e.priceYes == null || (e.priceAsOf != null && (now - Date.parse(e.priceAsOf)) / 3_600_000 <= STALE_HOURS)
  const gradeable = (e: CatalogEntry) => {
    const t = track[e.rulebookHash]
    return !!t && !t.settled
  }

  // One-time migration: prune UNGRADEABLE, still-unsettled locks made before the
  // fan-out guard existed (grading two arbitrary group representatives against each
  // other is meaningless — those entries could only ever pollute the record).
  let pruned = 0
  for (const [key, entry] of Object.entries(pairTrack)) {
    if (entry.settled) continue
    const legFanOut = (hash: string) => {
      const cat = byHash.get(hash)
      return cat ? cat.marketCount > 1 : false
    }
    const missingCounts = entry.kalshi.marketCount == null || entry.poly.marketCount == null
    if (missingCounts && (legFanOut(entry.kalshi.hash) || legFanOut(entry.poly.hash))) {
      delete pairTrack[key]
      pruned++
    }
  }

  let locked = 0
  for (const p of Object.values(pairs)) {
    if (pairTrack[p.pairKey]) continue
    if (!p.divergence || !p.match || (p.match.same_event !== 'yes' && p.match.same_event !== 'partial')) continue
    const k = byHash.get(p.kalshiHash)
    const m = byHash.get(p.polyHash)
    if (!k || !m || !stillOpen(k) || !stillOpen(m)) continue
    // Fan-out families are ungradeable at rulebook level — their leg pairs grade
    // instead. Trust the legs array as much as marketCount, since a mislabeled
    // marketCount (fast-lane bug window) must never mint a fabricated 1×1 "split".
    const fanOut = (e: typeof k) => e.marketCount > 1 || (e.legs?.length ?? 0) > 1
    if (fanOut(k) || fanOut(m)) continue
    if (!gradeable(k) || !gradeable(m)) continue
    if (!fresh(k) || !fresh(m)) continue
    const base = baseDivergence(p.divergence)
    const gap = k.priceYes != null && m.priceYes != null ? Math.abs(k.priceYes - m.priceYes) : null
    pairTrack[p.pairKey] = {
      pairKey: p.pairKey,
      lockedAt: new Date().toISOString(),
      kalshi: { platform: 'Kalshi', hash: k.rulebookHash, marketId: k.marketId, question: k.question, closeDate: k.closeDate, priceYesAtLock: k.priceYes, marketCount: k.marketCount },
      poly: { platform: 'Polymarket', hash: m.rulebookHash, marketId: m.marketId, question: m.question, closeDate: m.closeDate, priceYesAtLock: m.priceYes, marketCount: m.marketCount },
      sameEvent: p.match.same_event,
      divergenceBase: base,
      gapAtLock: gap,
      scenarioThatSplits: p.divergence.scenario_that_splits,
      settled: false,
    }
    locked++
  }

  // 4b. LEG-LEVEL matching — what makes fan-out families gradeable. Deterministic
  // and free: Kalshi legs come from the catalog; Polymarket siblings are fetched
  // once per family (the venue's grouped event). Exact-label legs are the same
  // claim on both venues and lock as same-event 1×1 pairs.
  const GAMMA = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'
  // Returns Leg[] on a definitive answer (possibly empty), or NULL when the fetch
  // failed — the caller must treat null as "unknown, leave existing matches/locks
  // alone", never as "no legs" (which would clear paid matches and prune leg locks).
  const polyLegCache = new Map<string, Leg[]>()
  async function polyLegsFor(polyMarketId: string): Promise<Leg[] | null> {
    if (polyLegCache.has(polyMarketId)) return polyLegCache.get(polyMarketId)!
    let legs: Leg[] = []
    const m = await tryGetJson(`${GAMMA}/markets/${encodeURIComponent(polyMarketId)}`)
    if (!m) return null // fetch failed — do not clobber locked history on a transient error
    const evSlug = m?.events?.[0]?.slug
    if (evSlug) {
      const ev = await tryGetJson(`${GAMMA}/events?slug=${encodeURIComponent(evSlug)}`)
      const markets: any[] = (Array.isArray(ev) ? ev[0] : ev)?.markets ?? []
      legs = markets
        .map((x: any) => {
          let priceYes: number | null = null
          try {
            const op = typeof x.outcomePrices === 'string' ? JSON.parse(x.outcomePrices) : x.outcomePrices
            const p = Array.isArray(op) && op[0] != null ? Number(op[0]) : NaN
            if (p > 0 && p < 1) priceYes = p
          } catch {
            /* none */
          }
          return {
            marketId: String(x.id ?? ''),
            label: String(x.groupItemTitle || x.question || ''),
            priceYes,
            volume: Number(x.volumeNum || 0),
          }
        })
        .filter((l: Leg) => l.marketId && l.label)
    } else if (m && m.groupItemTitle) {
      // Ungrouped single market: usable as a leg ONLY when the venue gives it a real
      // leg label. A full question is not a leg label — fuzzy-matching against
      // question tokens manufactures junk pairs (a date strike ⊆ any question
      // mentioning the date).
      let priceYes: number | null = null
      try {
        const op = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices
        const p = Array.isArray(op) && op[0] != null ? Number(op[0]) : NaN
        if (p > 0 && p < 1) priceYes = p
      } catch {
        /* none */
      }
      legs = [
        {
          marketId: String(m.id ?? polyMarketId),
          label: String(m.groupItemTitle),
          priceYes,
          volume: Number(m.volumeNum || 0),
        },
      ]
    }
    polyLegCache.set(polyMarketId, legs)
    return legs
  }

  let legPairsTotal = 0
  let legLocked = 0
  for (const p of Object.values(pairs)) {
    if (!p.active || !p.divergence || !p.match) continue
    if (p.match.same_event !== 'yes' && p.match.same_event !== 'partial') continue
    const k = byHash.get(p.kalshiHash)
    const m = byHash.get(p.polyHash)
    if (!k?.legs?.length || !m) continue // leg matching needs a Kalshi fan-out side
    try {
      // Stored family legs first (built at ingest/worldcup time); API fetch only as
      // fallback for markets whose event grouping we never captured.
      const pLegs: Leg[] | null = m.legs?.length ? m.legs.map((l) => ({ ...l })) : await polyLegsFor(m.marketId)
      if (pLegs === null) continue // transient fetch failure — never touch existing matches/locks
      if (!pLegs.length) {
        // Venue AFFIRMATIVELY returned no matchable legs: clear stale matches so the
        // prune below can disown locks the matcher no longer stands behind.
        if (p.legPairs?.length) {
          p.legPairs = []
          savePairs(pairs)
        }
        continue
      }
      const kLegs: Leg[] = k.legs.map((l) => ({ ...l }))
      const matched = matchLegs(kLegs, pLegs)
      p.legPairs = matched.map((x) => ({
        label: x.label,
        quality: x.quality,
        kalshi: { marketId: x.kalshi.marketId, label: x.kalshi.label, priceYes: x.kalshi.priceYes },
        poly: { marketId: x.poly.marketId, label: x.poly.label, priceYes: x.poly.priceYes },
        gap:
          x.kalshi.priceYes != null && x.poly.priceYes != null ? Math.abs(x.kalshi.priceYes - x.poly.priceYes) : null,
        matchedAt: new Date().toISOString(),
      }))
      legPairsTotal += matched.length
      savePairs(pairs)

      // Lock each matched leg as its own gradeable ledger entry (1×1 by construction).
      // Exact-label legs are the same claim → sameEvent 'yes'; fuzzy stays 'partial'.
      if (!stillOpen(k) || !stillOpen(m) || !fresh(k) || !fresh(m)) continue
      const base = baseDivergence(p.divergence)
      for (const x of matched) {
        const legKey = `${p.pairKey}#${x.label}`
        if (pairTrack[legKey]) continue
        pairTrack[legKey] = {
          pairKey: legKey,
          lockedAt: new Date().toISOString(),
          kalshi: { platform: 'Kalshi', hash: p.kalshiHash, marketId: x.kalshi.marketId, question: `${k.question} — ${x.kalshi.label}`, closeDate: k.closeDate, priceYesAtLock: x.kalshi.priceYes, marketCount: 1 },
          poly: { platform: 'Polymarket', hash: p.polyHash, marketId: x.poly.marketId, question: x.poly.label, closeDate: m.closeDate, priceYesAtLock: x.poly.priceYes, marketCount: 1 },
          sameEvent: x.quality === 'exact' ? 'yes' : 'partial',
          divergenceBase: base,
          gapAtLock:
            x.kalshi.priceYes != null && x.poly.priceYes != null
              ? Math.abs(x.kalshi.priceYes - x.poly.priceYes)
              : null,
          scenarioThatSplits: p.divergence.scenario_that_splits,
          leg: { label: x.label, quality: x.quality, parentPairKey: p.pairKey },
          settled: false,
        }
        legLocked++
      }
    } catch {
      /* leg matching is best-effort; the family pair stands either way */
    }
  }
  // Prune UNSETTLED leg locks the current (stricter) matcher no longer produces —
  // a lock the matcher has disowned could never be graded honestly. Settled legs
  // are history and are never touched.
  let legPruned = 0
  for (const [key, entry] of Object.entries(pairTrack)) {
    if (!entry.leg || entry.settled) continue
    const parent = pairs[entry.leg.parentPairKey]
    const stillMatched = parent?.legPairs?.some((x) => x.label === entry.leg!.label)
    if (!stillMatched) {
      delete pairTrack[key]
      legPruned++
    }
  }
  if (legPairsTotal || legPruned) {
    console.log(`  Legs: ${legPairsTotal} matched across families, ${legLocked} newly locked${legPruned ? `, ${legPruned} disowned locks pruned` : ''}.`)
  }

  // Reconciliation: when a later re-confirmation supersedes a locked same-event
  // verdict, ANNOTATE the ledger entry (never edit locked fields) so split
  // accounting excludes it and the disagreement is visible.
  let superseded = 0
  for (const entry of Object.values(pairTrack)) {
    if (entry.leg) continue // leg sameEvent is label-quality-based, not the family verdict
    const current = pairs[entry.pairKey]?.match?.same_event
    if (current && current !== entry.sameEvent && !entry.verdictNow) {
      entry.verdictNow = current
      entry.verdictSupersededAt = new Date().toISOString()
      superseded++
      console.log(`  note: locked verdict '${entry.sameEvent}' superseded by '${current}' — ${entry.kalshi.question.slice(0, 44)}`)
    }
  }

  const { graded, splits } = gradePairs(pairTrack)
  savePairTrack(pairTrack)
  if (pruned) console.log(`  (pruned ${pruned} ungradeable pre-guard lock${pruned === 1 ? '' : 's'} — fan-out legs)`)
  if (superseded) console.log(`  (${superseded} locked verdict${superseded === 1 ? '' : 's'} superseded — excluded from split accounting)`)

  const confirmed = Object.values(pairs).filter((p) => p.match?.same_event === 'yes' || p.match?.same_event === 'partial')
  console.log(
    `\n  Pairs: ${confirmed.length} confirmed (${Object.values(pairs).filter((p) => p.match?.same_event === 'yes').length} same-event, ${Object.values(pairs).filter((p) => p.match?.same_event === 'partial').length} partial) · ledger +${locked} locked, ${graded} graded${splits ? `, ${splits} SPLIT` : ''}.`,
  )

  if (report) {
    const rows = confirmed
      .filter((p) => p.divergence && p.active)
      .map((p) => {
        const k = byHash.get(p.kalshiHash)
        const m = byHash.get(p.polyHash)
        const { risk, base, gap } = pairRisk(p.divergence!, k?.priceYes ?? null, m?.priceYes ?? null)
        return { p, k, m, risk, base, gap }
      })
      .sort((a, b) => b.risk - a.risk)
    console.log(`\n  ${'risk'.padStart(4)} ${'base'.padStart(4)} ${'gap'.padStart(5)}  pair`)
    console.log('  ' + '─'.repeat(94))
    for (const r of rows) {
      const gapStr = r.gap == null ? '  —' : `${Math.round(r.gap * 100)}¢`
      console.log(
        `  ${String(r.risk).padStart(4)} ${String(r.base).padStart(4)} ${gapStr.padStart(5)}  [${r.p.match!.same_event}] ${r.k?.question.slice(0, 38)} ↔ ${r.m?.question.slice(0, 38)}`,
      )
      const top = [...r.p.divergence!.items].sort((a, b) => b.severity - a.severity)[0]
      if (top) {
        console.log(`${' '.repeat(21)}${top.topic}(${top.severity}): K "${top.kalshi_clause.slice(0, 60)}…" · P "${top.polymarket_clause.slice(0, 60)}…"`)
      }
      if (r.p.divergence!.scenario_that_splits) {
        console.log(`${' '.repeat(21)}splits: ${r.p.divergence!.scenario_that_splits.slice(0, 100)}`)
      }
    }
    console.log('')
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
