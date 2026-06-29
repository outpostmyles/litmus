import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadCatalog, loadScores } from './store'

export const WATCHLIST_PATH = 'data/cache/watchlist.json'

export interface WatchEntry {
  hash: string
  question: string
  platform: string
  addedAt: string
}
export type Watchlist = Record<string, WatchEntry>

function read(): Watchlist {
  try {
    return JSON.parse(readFileSync(WATCHLIST_PATH, 'utf8')) as Watchlist
  } catch {
    return {}
  }
}
function write(w: Watchlist): void {
  mkdirSync(dirname(WATCHLIST_PATH), { recursive: true })
  writeFileSync(WATCHLIST_PATH, JSON.stringify(w, null, 2))
}

export function loadWatchlist(): Watchlist {
  return read()
}

export function setWatch(hash: string, on: boolean, meta?: { question?: string; platform?: string }): Watchlist {
  const w = read()
  if (on) {
    w[hash] = {
      hash,
      question: meta?.question || w[hash]?.question || '',
      platform: meta?.platform || w[hash]?.platform || '',
      addedAt: w[hash]?.addedAt || new Date().toISOString(),
    }
  } else {
    delete w[hash]
  }
  write(w)
  return w
}

export interface WatchAlert {
  hash: string
  question: string
  platform: string
  /** Days until close (negative = past), or null. */
  daysUntil: number | null
  combined: number | null
  priceYes: number | null
  /** Still present in the current catalog (false = its rules changed or it delisted). */
  present: boolean
}

/**
 * Join the watchlist with the live catalog + scores and compute alerts:
 *  - closingSoon: watched markets resolving within `daysThreshold`.
 *  - changed: watched markets whose rulebook hash is gone (text edited or delisted).
 */
export function watchlistView(daysThreshold = 14): {
  entries: WatchAlert[]
  closingSoon: WatchAlert[]
  changed: WatchAlert[]
} {
  const w = loadWatchlist()
  const catalog = loadCatalog()
  const scores = loadScores()
  const byHash = new Map(catalog.map((e) => [e.rulebookHash, e]))

  const entries: WatchAlert[] = Object.values(w).map((we) => {
    const e = byHash.get(we.hash)
    const s = scores[we.hash]
    const closeDate = e?.closeDate ?? null
    const daysUntil = closeDate ? Math.round((new Date(closeDate).getTime() - Date.now()) / 86_400_000) : null
    return {
      hash: we.hash,
      question: e?.question || we.question || '(market)',
      platform: e?.platform || we.platform || '',
      daysUntil,
      combined: s?.combined ?? null,
      priceYes: e?.priceYes ?? null,
      present: !!e,
    }
  })

  const closingSoon = entries
    .filter((x) => x.present && x.daysUntil != null && x.daysUntil >= 0 && x.daysUntil <= daysThreshold)
    .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))
  const changed = entries.filter((x) => !x.present)

  return { entries, closingSoon, changed }
}
