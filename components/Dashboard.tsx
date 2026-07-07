'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  riskColor,
  BAND_LABEL,
  GLOSSARY,
  edgeTag,
  actionability,
  liveRisk,
  ageOf,
  STALE_HOURS,
  type RiskBand,
  type ScoreResult,
  type DimensionResult,
  type LiteralFavors,
} from '@/lib/litmus'
import { ResultCard } from './ResultCard'
import { VerdictLine, SideGlyphs, type VerdictData } from './Verdict'

function StarIcon({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3.6l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 17.9l-5.31 2.79 1.01-5.9-4.29-4.18 5.93-.86z" />
    </svg>
  )
}

interface PricePoint {
  t: string
  p: number
}

interface Item {
  rulebookHash: string
  platform: string
  marketId: string
  question: string
  category: string
  resolutionText: string
  resolutionSource: string | null
  outcomes: string[]
  closeDate: string | null
  volume: number
  marketCount: number
  priceYes: number | null
  priceAsOf: string | null
  delta1d: number | null
  delta7d: number | null
  history: PricePoint[]
  url: string | null
  scanLane: 'daily' | 'fast'
  detectedAt: string | null
  score: {
    combined: number
    band: RiskBand
    dimensions: DimensionResult[]
    namedSource: string | null
    assumedVsActual: string | null
    headlineRisk: string
    summary: string
    model: string
    scoredAt: string
    literalFavors?: LiteralFavors
    literalFavorsNote?: string
    leanConfidence?: number
    leanClauseQuote?: string | null
    leanCrowdConsistent?: boolean
    verdict?: VerdictData | null
  }
}

interface Payload {
  items: Item[]
  totalRulebooks: number
  scoredCount: number
  unscoredCount: number
  dataAsOf: string | null
}

interface Alert {
  hash: string
  question: string
  platform: string
  daysUntil: number | null
  combined: number | null
  priceYes: number | null
  present: boolean
}

const BANDS: (RiskBand | 'all')[] = ['all', 'severe', 'high', 'elevated', 'moderate', 'low']

function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(Math.round(n))
}
function fmtVol(platform: string, v: number): string {
  return platform === 'Polymarket' ? '$' + compact(v) : compact(v) + ' ct'
}
function fmtPrice(p: number | null): string | null {
  return p == null ? null : Math.round(p * 100) + '¢'
}
function closesIn(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'closed'
  if (days === 0) return 'today'
  if (days < 60) return days + 'd'
  if (days < 720) return Math.round(days / 30) + 'mo'
  return Math.round(days / 365) + 'y'
}
function toResult(it: Item): ScoreResult {
  return {
    combined: it.score.combined,
    band: it.score.band,
    dimensions: it.score.dimensions,
    namedSource: it.score.namedSource,
    assumedVsActual: it.score.assumedVsActual,
    headlineRisk: it.score.headlineRisk,
    summary: it.score.summary,
    model: it.score.model,
    literalFavors: it.score.literalFavors ?? null,
    literalFavorsNote: it.score.literalFavorsNote ?? null,
    leanConfidence: it.score.leanConfidence ?? null,
    leanClauseQuote: it.score.leanClauseQuote ?? null,
    leanCrowdConsistent: it.score.leanCrowdConsistent ?? null,
    verdict: it.score.verdict ?? null,
    market: {
      platform: it.platform,
      question: it.question,
      marketId: it.marketId,
      resolutionText: it.resolutionText,
      resolutionSource: it.resolutionSource,
      closeDate: it.closeDate,
      outcomes: it.outcomes,
      priceYes: it.priceYes,
      url: it.url,
    },
  }
}

/** Signed price move in cents: "+7¢" / "−4¢". Hidden under 1¢. */
function fmtDelta(d: number | null): string | null {
  if (d == null) return null
  const cents = Math.round(d * 100)
  if (cents === 0) return null
  return `${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`
}

/** Tiny inline price sparkline. Pure render — no axes, just the shape of the move. */
function Spark({ points, color }: { points: PricePoint[]; color: string }) {
  if (points.length < 3) return null
  const w = 56
  const h = 16
  const ps = points.map((pt) => pt.p)
  const min = Math.min(...ps)
  const max = Math.max(...ps)
  const span = Math.max(max - min, 0.02) // flat lines stay visually flat, not noisy
  const step = w / (ps.length - 1)
  const d = ps.map((p, i) => `${(i * step).toFixed(1)},${(h - ((p - min) / span) * h).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 opacity-70" aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function Dashboard() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [alerts, setAlerts] = useState<{ closingSoon: Alert[]; changed: Alert[] }>({ closingSoon: [], changed: [] })

  const [platform, setPlatform] = useState<'all' | 'Kalshi' | 'Polymarket'>('all')
  const [category, setCategory] = useState('all')
  const [band, setBand] = useState<RiskBand | 'all'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'risk' | 'live' | 'edge' | 'volume' | 'closing'>('live')
  const [edgesOnly, setEdgesOnly] = useState(false)
  const [watchOnly, setWatchOnly] = useState(false)
  const [newOnly, setNewOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [cRes, wRes] = await Promise.all([
        fetch('/api/catalog', { cache: 'no-store' }),
        fetch('/api/watchlist', { cache: 'no-store' }),
      ])
      if (!cRes.ok) throw new Error('Failed to load catalog.')
      const cj = (await cRes.json()) as Payload
      setData(cj)
      if (wRes.ok) {
        const wj = await wRes.json()
        setWatched(new Set<string>(wj.hashes || []))
        setAlerts({ closingSoon: wj.closingSoon || [], changed: wj.changed || [] })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function toggleWatch(it: Item) {
    const on = !watched.has(it.rulebookHash)
    setWatched((prev) => {
      const n = new Set(prev)
      if (on) n.add(it.rulebookHash)
      else n.delete(it.rulebookHash)
      return n
    })
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hash: it.rulebookHash, action: on ? 'add' : 'remove', question: it.question, platform: it.platform }),
      })
      const r = await fetch('/api/watchlist', { cache: 'no-store' })
      if (r.ok) {
        const wj = await r.json()
        setAlerts({ closingSoon: wj.closingSoon || [], changed: wj.changed || [] })
      }
    } catch {
      /* keep optimistic state */
    }
  }

  const items = data?.items ?? []
  const categories = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.category))).sort()], [items])
  const itemEdge = (i: Item) =>
    edgeTag(i.score.literalFavors, i.priceYes, i.score.leanConfidence, i.score.leanCrowdConsistent)
  const edgeCount = useMemo(() => items.filter((i) => itemEdge(i)).length, [items])

  const dataAge = ageOf(data?.dataAsOf)
  const isStale = data?.dataAsOf ? Date.now() - Date.parse(data.dataAsOf) > STALE_HOURS * 3_600_000 : false
  const NEW_HOURS = 48
  const isNew = (i: Item) => i.detectedAt != null && Date.now() - Date.parse(i.detectedAt) < NEW_HOURS * 3_600_000
  const newCount = useMemo(() => items.filter(isNew).length, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = items.filter((i) => {
      if (platform !== 'all' && i.platform !== platform) return false
      if (category !== 'all' && i.category !== category) return false
      if (band !== 'all' && i.score.band !== band) return false
      if (edgesOnly && !itemEdge(i)) return false
      if (watchOnly && !watched.has(i.rulebookHash)) return false
      if (newOnly && !isNew(i)) return false
      if (q && !i.question.toLowerCase().includes(q) && !i.score.headlineRisk.toLowerCase().includes(q)) return false
      return true
    })
    out.sort((a, b) => {
      if (sort === 'volume') return b.volume - a.volume
      if (sort === 'closing') {
        const ta = a.closeDate ? new Date(a.closeDate).getTime() : Infinity
        const tb = b.closeDate ? new Date(b.closeDate).getTime() : Infinity
        return ta - tb
      }
      if (sort === 'edge') {
        const aa = actionability(a.score.combined, itemEdge(a), a.closeDate, a.priceYes)
        const ab = actionability(b.score.combined, itemEdge(b), b.closeDate, b.priceYes)
        if (aa !== ab) return ab - aa
        return b.score.combined - a.score.combined
      }
      if (sort === 'live') {
        const la = liveRisk(a.score.combined, a.priceYes) ?? -1
        const lb = liveRisk(b.score.combined, b.priceYes) ?? -1
        if (la !== lb) return lb - la
        return b.score.combined - a.score.combined
      }
      return b.score.combined - a.score.combined
    })
    return out
  }, [items, platform, category, band, query, sort, edgesOnly, watchOnly, newOnly, watched])

  const hasAlerts = alerts.closingSoon.length > 0 || alerts.changed.length > 0

  return (
    <div>
      <div className="glass rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-xl bg-black/30 p-1">
            {(['all', 'Kalshi', 'Polymarket'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  platform === p ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {p === 'all' ? 'All' : p}
              </button>
            ))}
          </div>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-line bg-black/30 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-brand/40"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All categories' : c}
              </option>
            ))}
          </select>

          <select
            value={band}
            onChange={(e) => setBand(e.target.value as RiskBand | 'all')}
            className="rounded-xl border border-line bg-black/30 px-3 py-2 text-sm capitalize text-fg outline-none focus:ring-1 focus:ring-brand/40"
          >
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {b === 'all' ? 'Any risk' : b}
              </option>
            ))}
          </select>

          <button
            onClick={() => setEdgesOnly((v) => !v)}
            title={GLOSSARY.edge}
            className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
              edgesOnly ? 'border-brand/50 bg-brand/10 text-brand' : 'border-line text-muted hover:text-fg'
            }`}
          >
            edges{edgeCount ? ` (${edgeCount})` : ''}
          </button>

          <button
            onClick={() => setWatchOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
              watchOnly ? 'border-amber-400/50 bg-amber-400/10 text-amber-300' : 'border-line text-muted hover:text-fg'
            }`}
          >
            <StarIcon filled={watchOnly} size={13} /> watch{watched.size ? ` (${watched.size})` : ''}
          </button>

          <button
            onClick={() => setNewOnly((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
              newOnly ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' : 'border-line text-muted hover:text-fg'
            }`}
          >
            new{newCount ? ` (${newCount})` : ''}
          </button>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search…"
            className="mono min-w-[6rem] flex-1 rounded-xl border border-line bg-black/30 px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:ring-1 focus:ring-brand/40"
          />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'risk' | 'live' | 'edge' | 'volume' | 'closing')}
            className="rounded-xl border border-line bg-black/30 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-brand/40"
          >
            <option value="live">Sort: live risk</option>
            <option value="risk">Sort: text hazard</option>
            <option value="edge">Sort: edge</option>
            <option value="volume">Sort: volume</option>
            <option value="closing">Sort: closing soon</option>
          </select>

          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-line px-3 py-2 text-sm text-muted transition hover:border-brand/40 hover:text-fg disabled:opacity-40"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>

        {data && (
          <div className="mono mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-faint">
            <span>
              {filtered.length} shown · {data.scoredCount} scored · <span className="text-brand">{edgeCount} edges</span>
            </span>
            {dataAge && (
              <span className={isStale ? 'text-rose-300' : ''}>
                prices as of {dataAge}
                {isStale && ' — stale, run npm run ingest'}
              </span>
            )}
            {data.unscoredCount > 0 && (
              <span className="text-amber-300/80">
                {data.unscoredCount} not yet scored — new listings score automatically within ~2 min; the rest on the
                next <span className="text-amber-200">npm run backfill</span>
              </span>
            )}
          </div>
        )}
      </div>

      {hasAlerts && (
        <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
          <div className="mono text-[0.7rem] uppercase tracking-wider text-amber-300">alerts</div>
          <div className="mt-1.5 space-y-1 text-sm">
            {alerts.closingSoon.map((a) => (
              <div key={a.hash} className="text-fg/90">
                <span className="mono text-amber-300">{a.daysUntil === 0 ? 'today' : a.daysUntil + 'd'}</span> · {a.question}
                {a.combined != null && <span className="text-faint"> · risk {a.combined}</span>}
              </div>
            ))}
            {alerts.changed.map((a) => (
              <div key={a.hash} className="text-rose-300">
                rules changed / closed · {a.question}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
      )}

      {loading && !data && (
        <div className="glass mt-6 rounded-2xl px-6 py-16 text-center text-sm text-muted">
          Loading the board — scores come from the local cache, so this takes about a second.
        </div>
      )}

      {!loading && data && data.scoredCount === 0 && !error && (
        <div className="glass mt-6 rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-muted">No scored markets cached yet.</p>
          <p className="mono mt-3 text-xs text-faint">
            run <span className="text-fg">npm run ingest</span> then <span className="text-fg">npm run backfill</span>
          </p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {filtered.map((it, rank) => {
          const color = riskColor(it.score.combined)
          const isOpen = expanded === it.rulebookHash
          const isWatched = watched.has(it.rulebookHash)
          const closes = closesIn(it.closeDate)
          const price = fmtPrice(it.priceYes)
          const delta = fmtDelta(it.delta1d)
          const edge = itemEdge(it)
          const act = edge ? actionability(it.score.combined, edge, it.closeDate, it.priceYes) : 0
          const live = liveRisk(it.score.combined, it.priceYes)
          return (
            <div key={it.rulebookHash}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isOpen ? null : it.rulebookHash)}
                onKeyDown={(e) => {
                  // Only when the row itself is focused — Enter on a nested link/button
                  // must activate that child, not toggle the row.
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setExpanded(isOpen ? null : it.rulebookHash)
                  }
                }}
                className="glass relative flex cursor-pointer items-center gap-4 overflow-hidden rounded-2xl px-4 py-3.5 outline-none transition-colors hover:bg-white/[0.02] focus-visible:ring-1 focus-visible:ring-brand/40 sm:px-5"
              >
                <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
                <div className="mono w-5 shrink-0 text-center text-sm text-faint">{rank + 1}</div>
                <div className="flex w-16 shrink-0 flex-col items-center">
                  <span className="mono text-2xl font-semibold leading-none tabular-nums" style={{ color }}>
                    {it.score.combined}
                  </span>
                  <span className="mono mt-1 text-[0.56rem] tracking-[0.12em]" style={{ color }}>
                    {BAND_LABEL[it.score.band] ?? it.score.band}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mono flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.62rem] uppercase tracking-wider text-faint">
                    <span>{it.platform}</span>
                    <span className="text-faint/70">{it.category}</span>
                    <span className="text-muted">{fmtVol(it.platform, it.volume)}</span>
                    {price && <span className="text-fg/80">Yes {price}</span>}
                    {delta && <span className="text-fg/60">Δ24h {delta}</span>}
                    {live != null && live !== it.score.combined && (
                      <span className="text-faint/80" title={GLOSSARY.liveRisk}>
                        live {live}
                      </span>
                    )}
                    {it.marketCount > 1 && <span className="text-faint/70">×{it.marketCount}</span>}
                    {closes && <span className="text-faint/70">{closes}</span>}
                    {isNew(it) && (
                      <span className="rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[0.6rem] text-emerald-300">
                        new · {ageOf(it.detectedAt) ?? ''}
                        {it.scanLane === 'fast' ? ' · fast-scan' : ''}
                      </span>
                    )}
                    {!it.score.namedSource && <span className="text-rose-300">no source</span>}
                    {edge && (
                      <span className="rounded-md bg-brand/15 px-1.5 py-0.5 text-[0.6rem] text-brand" title={`${GLOSSARY.edge} "act" — ${GLOSSARY.act}`}>
                        act {act} · {edge.label}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[0.95rem] font-medium text-fg">{it.question}</div>
                  {it.score.verdict ? (
                    <div className="mt-1 flex min-w-0 items-baseline gap-2.5">
                      <VerdictLine v={it.score.verdict} compact />
                      <SideGlyphs v={it.score.verdict} />
                    </div>
                  ) : (
                    <div className="mt-0.5 line-clamp-1 text-[0.82rem] text-muted">{it.score.headlineRisk}</div>
                  )}
                </div>
                {it.history.length >= 3 && (
                  <div className="hidden md:block">
                    <Spark points={it.history} color={color} />
                  </div>
                )}
                {it.url && (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`open on ${it.platform}`}
                    className="shrink-0 px-1 text-faint transition-colors hover:text-brand"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleWatch(it)
                  }}
                  aria-label={isWatched ? 'unwatch' : 'watch'}
                  className={`shrink-0 px-1 transition-colors ${
                    isWatched ? 'text-amber-300' : 'text-faint hover:text-amber-300'
                  }`}
                >
                  <StarIcon filled={isWatched} />
                </button>
                <div className={`mono shrink-0 text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</div>
              </div>

              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-3"
                >
                  <ResultCard r={toResult(it)} />
                </motion.div>
              )}
            </div>
          )
        })}

        {!loading && filtered.length === 0 && data && data.scoredCount > 0 && (
          <div className="glass rounded-2xl px-6 py-12 text-center text-sm text-muted">No markets match those filters.</div>
        )}
      </div>
    </div>
  )
}
