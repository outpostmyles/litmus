import { execFileSync } from 'node:child_process'
import { loadWatcherState, saveWatcherState, type WatcherState } from '../engine/watcher/state'
import { detectNew, triage } from '../engine/watcher/triage'
import { pollKalshi, pollPolymarket } from './poll'
import { fastScan, makeClient } from './fastscan'
import { loadScores, loadCatalog } from '../cache/store'
import { spendSummary } from '../lib/spend'

// The fast-scan daemon: a single long-running process with an internal scheduler.
// systemd-friendly by construction — no macOS assumptions, structured JSON logs on
// stdout, graceful SIGTERM/SIGINT shutdown, state persisted so restarts never
// re-announce known markets.
//
//   npm run watch                    — run forever, polling every WATCHER_POLL_MINUTES
//   npm run watch -- --once          — one poll cycle, then exit
//   npm run watch -- --dry-run-replay — replay the last 48h of detections through
//                                       triage from stored data; zero API calls

const POLL_MINUTES = Number(process.env.WATCHER_POLL_MINUTES || '5')

type LogLevel = 'info' | 'warn' | 'error'
function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }))
}

/** Best-effort desktop ping (macOS only; a no-op on the server, where logs are the channel). */
function notify(message: string): void {
  if (process.platform !== 'darwin') return
  try {
    execFileSync('osascript', ['-e', `display notification "${message.replace(/["·]/g, '-')}" with title "Litmus fast-scan"`])
  } catch {
    /* best effort */
  }
}

let stopping = false

async function pollCycle(state: WatcherState): Promise<void> {
  const [kalshi, poly] = await Promise.all([
    pollKalshi().catch((e) => {
      log('warn', 'poll_failed', { venue: 'kalshi', error: String(e) })
      return null
    }),
    pollPolymarket().catch((e) => {
      log('warn', 'poll_failed', { venue: 'polymarket', error: String(e) })
      return null
    }),
  ])

  // Bootstrap: first ever run marks everything as known — no announcements. Only
  // COMPLETE bootstrap when BOTH venues responded; otherwise a failed first poll
  // would commit an empty known-set and the next success would flood the entire
  // universe as "new". Seed each venue that succeeded and retry the other next cycle.
  if (!state.bootstrappedAt) {
    if (kalshi) state.knownIds.kalshi = kalshi.map((k) => k.eventTicker)
    if (poly) state.knownIds.polymarket = poly.map((p) => p.id)
    if (kalshi && poly) {
      state.bootstrappedAt = new Date().toISOString()
      log('info', 'bootstrapped', { kalshi: state.knownIds.kalshi.length, polymarket: state.knownIds.polymarket.length })
    } else {
      log('warn', 'bootstrap_partial', { kalshiOk: !!kalshi, polyOk: !!poly, retrying: true })
    }
    state.lastPollAt = new Date().toISOString()
    saveWatcherState(state)
    return
  }

  const newKalshi = kalshi ? detectNew(new Set(state.knownIds.kalshi), kalshi.map((k) => k.eventTicker)) : []
  const newPoly = poly ? detectNew(new Set(state.knownIds.polymarket), poly.map((p) => p.id)) : []
  log('info', 'poll_complete', { newKalshi: newKalshi.length, newPolymarket: newPoly.length })

  const client = newKalshi.length || newPoly.length ? makeClient() : null
  let cacheHits = 0
  let processed = 0

  for (const l of [
    ...newKalshi.map((id) => ({ venue: 'kalshi' as const, data: kalshi!.find((k) => k.eventTicker === id)! })),
    ...newPoly.map((id) => ({ venue: 'polymarket' as const, data: poly!.find((p) => p.id === id)! })),
  ]) {
    if (stopping) break
    const started = Date.now()
    const result = await fastScan(l, client ?? undefined)
    processed++
    if (result.outcome === 'cache-hit') cacheHits++
    state.recent.push(result)
    log('info', 'listing_processed', {
      venue: result.venue,
      id: result.id,
      question: result.question.slice(0, 60),
      outcome: result.outcome,
      combined: result.combined ?? null,
      alert: result.alert ?? false,
      reasons: result.reasons ?? [],
      ms: Date.now() - started,
    })
    if (result.alert) notify(`NEW ${result.question.slice(0, 48)} — ${(result.reasons ?? []).join(' · ')}`)
  }

  // Only mark as known AFTER processing so a crash re-tries next cycle (idempotent:
  // catalog merge, scoring cache, and locking are all keyed by hash).
  if (kalshi) state.knownIds.kalshi = [...new Set([...state.knownIds.kalshi, ...kalshi.map((k) => k.eventTicker)])]
  if (poly) state.knownIds.polymarket = [...new Set([...state.knownIds.polymarket, ...poly.map((p) => p.id)])]
  state.lastPollAt = new Date().toISOString()
  saveWatcherState(state)

  if (processed) {
    log('info', 'cycle_summary', {
      processed,
      cacheHits,
      cacheHitRate: processed ? +(cacheHits / processed).toFixed(2) : null,
      spend: spendSummary(),
    })
  }
}

/** Replay stored detections through triage using cached data only — zero API cost. */
function dryRunReplay(state: WatcherState): void {
  const scores = loadScores()
  const catalog = loadCatalog()
  const byHash = new Map(catalog.map((c) => [c.rulebookHash, c]))
  console.log(`\n  Dry-run replay: ${state.recent.length} detections from the last 48h\n`)
  for (const r of state.recent) {
    const s = r.rulebookHash ? scores[r.rulebookHash] : undefined
    const c = r.rulebookHash ? byHash.get(r.rulebookHash) : undefined
    const d = triage({
      combined: s?.combined ?? null,
      band: s?.band ?? null,
      literalFavors: s?.literalFavors ?? null,
      leanConfidence: s?.leanConfidence ?? null,
      leanCrowdConsistent: s?.leanCrowdConsistent ?? null,
      priceYes: c?.priceYes ?? null,
      crossvenueDivergence: false,
    })
    console.log(
      `  ${d.alert ? 'ALERT ' : 'quiet '} ${String(s?.combined ?? '—').padStart(3)}  [${r.outcome ?? '?'}] ${r.question.slice(0, 52)}${d.reasons.length ? `  (${d.reasons.join(' · ')})` : ''}`,
    )
  }
  console.log('')
}

async function main(): Promise<void> {
  const state = loadWatcherState()
  if (process.argv.includes('--dry-run-replay')) {
    dryRunReplay(state)
    return
  }
  const once = process.argv.includes('--once')

  const shutdown = (signal: string) => {
    log('info', 'shutdown', { signal })
    stopping = true
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  log('info', 'watcher_start', { pollMinutes: POLL_MINUTES, once })
  do {
    try {
      await pollCycle(state)
    } catch (e) {
      log('error', 'cycle_failed', { error: String(e) })
    }
    if (once || stopping) break
    // Jittered sleep so two instances / restarts don't sync-hammer the APIs.
    const delay = POLL_MINUTES * 60_000 * (0.9 + Math.random() * 0.2)
    await new Promise((r) => setTimeout(r, delay))
  } while (!stopping)
  log('info', 'watcher_exit', {})
}

main().catch((e) => {
  log('error', 'fatal', { error: String(e) })
  process.exit(1)
})
