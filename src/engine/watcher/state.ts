import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

// Watcher state: which market IDs we've already seen (so restarts never
// re-announce known markets) plus a rolling window of recent detections that
// powers the dry-run replay mode.
export const WATCHER_STATE_PATH = 'data/cache/watcher-state.json'

export interface RecentListing {
  venue: 'kalshi' | 'polymarket'
  id: string
  question: string
  detectedAt: string
  /** What happened: scored fresh, cache hit, deferred (budget), or error. */
  outcome?: 'scored' | 'cache-hit' | 'deferred' | 'error' | 'skipped'
  rulebookHash?: string
  alert?: boolean
  reasons?: string[]
}

export interface WatcherState {
  /** Every market/event ID ever seen per venue. Bootstrap marks all current as known. */
  knownIds: { kalshi: string[]; polymarket: string[] }
  lastPollAt: string | null
  bootstrappedAt: string | null
  /** Rolling window (~48h) of detections, for the dry-run replay. */
  recent: RecentListing[]
}

const RECENT_HOURS = 48

export function loadWatcherState(): WatcherState {
  if (!existsSync(WATCHER_STATE_PATH)) {
    return { knownIds: { kalshi: [], polymarket: [] }, lastPollAt: null, bootstrappedAt: null, recent: [] }
  }
  return JSON.parse(readFileSync(WATCHER_STATE_PATH, 'utf8')) as WatcherState
}

export function saveWatcherState(s: WatcherState): void {
  // Trim the replay window on every save.
  const cutoff = Date.now() - RECENT_HOURS * 3_600_000
  s.recent = s.recent.filter((r) => Date.parse(r.detectedAt) >= cutoff)
  mkdirSync(dirname(WATCHER_STATE_PATH), { recursive: true })
  const tmp = `${WATCHER_STATE_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2))
  renameSync(tmp, WATCHER_STATE_PATH)
}
