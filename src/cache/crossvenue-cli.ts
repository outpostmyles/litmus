import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../lib/env'
import { acquireRunLock } from '../lib/runlock'
import { STALE_HOURS } from '../../lib/litmus'
import { loadCatalog, type CatalogEntry } from './store'
import { loadPairs, savePairs, pairKey, CROSSVENUE_LOCK, type PairRecord } from './pairs-store'
import { generateCandidates, type CandidateMarket } from '../engine/crossvenue/candidates'
import { confirmMatch, type MarketBrief } from '../engine/crossvenue/matchConfirm'
import { scoreDivergence } from '../engine/crossvenue/divergenceScore'
import { baseDivergence, pairRisk } from '../engine/crossvenue/pairRisk'
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
    console.log(`  Confirming ${needConfirm.length} pairs on ${MATCH_MODEL} (~$${(needConfirm.length * EST_CONFIRM_COST).toFixed(2)})…`)
    await mapPool(needConfirm, CONCURRENCY, async (p) => {
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
    if (k.marketCount > 1 || m.marketCount > 1) continue // fan-out groups are ungradeable
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

  // Reconciliation: when a later re-confirmation supersedes a locked same-event
  // verdict, ANNOTATE the ledger entry (never edit locked fields) so split
  // accounting excludes it and the disagreement is visible.
  let superseded = 0
  for (const entry of Object.values(pairTrack)) {
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
