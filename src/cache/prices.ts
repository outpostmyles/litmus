import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CatalogEntry } from './store'

// Price time-series, one series per rulebook hash, appended by each (free) ingest.
// A single overwritten priceYes can't show momentum; the series is what lets the tool
// see the crowd moving toward or away from the rules-implied side.
export const PRICES_PATH = 'data/cache/prices.json'

export interface PricePoint {
  /** ISO timestamp the price was observed. */
  t: string
  /** Implied Yes probability (0–1). */
  p: number
}

export type PriceHistory = Record<string, PricePoint[]>

/** Keep roughly six months of daily points per rulebook. */
const MAX_POINTS = 180
/** A new point must be at least this much newer than the last, unless the price moved. */
const MIN_GAP_HOURS = 20

export function loadPrices(): PriceHistory {
  try {
    return JSON.parse(readFileSync(PRICES_PATH, 'utf8')) as PriceHistory
  } catch {
    return {}
  }
}

export function savePrices(h: PriceHistory): void {
  mkdirSync(dirname(PRICES_PATH), { recursive: true })
  writeFileSync(PRICES_PATH, JSON.stringify(h))
}

/**
 * Append the catalog's current prices to the history. Daily runs add one point per
 * rulebook; extra same-day runs only add a point when the price actually moved, so
 * manual refreshes don't bloat the file.
 */
export function appendPrices(catalog: CatalogEntry[], now = new Date()): { appended: number; series: number } {
  const h = loadPrices()
  // Prune series for rulebooks that left the universe long ago (closed, below the
  // volume floor, rules changed) — otherwise dead series accumulate forever.
  const DEAD_DAYS = 60
  const deadCutoff = now.getTime() - DEAD_DAYS * 86_400_000
  const live = new Set(catalog.map((e) => e.rulebookHash))
  for (const [hash, series] of Object.entries(h)) {
    const newest = series.length ? Date.parse(series[series.length - 1]!.t) : 0
    if (!live.has(hash) && newest < deadCutoff) delete h[hash]
  }
  let appended = 0
  for (const e of catalog) {
    if (e.priceYes == null) continue
    const series = h[e.rulebookHash] ?? []
    const last = series[series.length - 1]
    const t = e.priceAsOf ?? now.toISOString()
    if (last) {
      const gapH = (Date.parse(t) - Date.parse(last.t)) / 3_600_000
      if (!(gapH >= MIN_GAP_HOURS || Math.abs(e.priceYes - last.p) >= 0.005)) continue
      if (gapH <= 0) continue // never append out-of-order points
    }
    series.push({ t, p: e.priceYes })
    if (series.length > MAX_POINTS) series.splice(0, series.length - MAX_POINTS)
    h[e.rulebookHash] = series
    appended++
  }
  savePrices(h)
  return { appended, series: Object.keys(h).length }
}

/**
 * The most recent point at least `hours` old — but no older than `maxHours` — or null.
 * The upper bound matters: after a gap in the series (job down, market re-entered the
 * catalog), an unbounded lookback would silently label a multi-week move as "Δ24h".
 */
export function pointBefore(
  series: PricePoint[] | undefined,
  hours: number,
  now = Date.now(),
  maxHours = Infinity,
): PricePoint | null {
  if (!series?.length) return null
  const cutoff = now - hours * 3_600_000
  const oldest = now - maxHours * 3_600_000
  for (let i = series.length - 1; i >= 0; i--) {
    const t = Date.parse(series[i]!.t)
    if (t <= cutoff) return t >= oldest ? series[i]! : null
  }
  return null
}

/** Price change vs ~24h ago and ~7d ago (current − then). Null when the series has a gap. */
export function priceDeltas(
  series: PricePoint[] | undefined,
  current: number | null,
  now = Date.now(),
): { d1: number | null; d7: number | null } {
  if (current == null) return { d1: null, d7: null }
  const p1 = pointBefore(series, 24, now, 36) // a "24h" move must come from a ≤36h-old point
  const p7 = pointBefore(series, 24 * 7, now, 24 * 10)
  return { d1: p1 ? current - p1.p : null, d7: p7 ? current - p7.p : null }
}
