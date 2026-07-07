'use client'

import { useEffect, useState } from 'react'
import { riskColor, ageOf, GLOSSARY, STALE_HOURS } from '@/lib/litmus'

interface Leg {
  question: string
  priceYes: number | null
  closeDate: string | null
  url: string | null
  marketId: string
}

interface DivergenceItem {
  topic: string
  severity: number
  kalshi_clause: string
  polymarket_clause: string
  explanation: string
}

interface PairRow {
  pairKey: string
  sameEvent: 'yes' | 'partial'
  risk: number
  base: number
  gap: number | null
  scenario: string | null
  scenarioYesVenue: 'kalshi' | 'polymarket' | null
  splitsIfShort: string | null
  legPairs: {
    label: string
    quality: 'exact' | 'fuzzy'
    kalshi: { marketId: string; label: string; priceYes: number | null }
    poly: { marketId: string; label: string; priceYes: number | null }
    gap: number | null
    settlement?: 'identical' | 'split' | 'divergent-partial' | 'non-comparable'
    outcomes?: { kalshi?: string; poly?: string }
  }[]
  legSettled?: number
  legSplits?: number
  summary: string
  items: DivergenceItem[]
  kalshi: Leg | null
  poly: Leg | null
  settlement: 'identical' | 'split' | 'divergent-partial' | 'non-comparable' | null
  outcomes: { kalshi?: string; poly?: string } | null
}

interface Payload {
  rows: PairRow[]
  counts: {
    confirmed: number
    sameEvent: number
    partial: number
    awaitingDivergence: number
    settled: number
    splits: number
  }
  dataAsOf: string | null
}

const cents = (p: number | null | undefined) => (p == null ? '—' : Math.round(p * 100) + '¢')

function LegLine({ leg, venue }: { leg: Leg | null; venue: string }) {
  if (!leg) return null
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="mono w-20 shrink-0 text-[0.62rem] uppercase tracking-wider text-faint">{venue}</span>
      <span className="truncate text-[0.9rem] text-fg">{leg.question}</span>
      <span className="mono shrink-0 text-xs text-fg/80">{cents(leg.priceYes)}</span>
      {leg.url && (
        <a
          href={leg.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mono shrink-0 text-[0.68rem] text-faint transition-colors hover:text-brand"
          aria-label={`open on ${venue}`}
        >
          open ↗
        </a>
      )}
    </div>
  )
}

export function PairsClient() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [partialOnly, setPartialOnly] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/pairs', { cache: 'no-store' })
        if (!res.ok) throw new Error('Failed to load pairs.')
        setData((await res.json()) as Payload)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading)
    return (
      <div className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted">
        Loading cross-venue pairs — the same event on both venues, rules diffed clause by clause.
      </div>
    )
  if (error) return <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
  if (!data) return null

  const { rows, counts } = data
  const dataAge = ageOf(data.dataAsOf)
  const isStale = data.dataAsOf ? Date.now() - Date.parse(data.dataAsOf) > STALE_HOURS * 3_600_000 : false
  const shown = rows.filter((r) => !partialOnly || r.sameEvent === 'partial')

  return (
    <div>
      <div className="glass flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3">
        <span className="mono text-xs text-faint">
          {counts.confirmed} confirmed pairs · {counts.sameEvent} same-event ·{' '}
          <span className="text-amber-300">{counts.partial} partial (most dangerous)</span> · {counts.settled} settled
          {counts.splits > 0 && <span className="text-rose-300"> · {counts.splits} SPLIT</span>}
          {counts.awaitingDivergence > 0 && (
            <span className="text-faint"> · {counts.awaitingDivergence} awaiting divergence scoring</span>
          )}
        </span>
        {dataAge && (
          <span className={`mono text-xs ${isStale ? 'text-rose-300' : 'text-faint'}`}>
            prices as of {dataAge}
            {isStale && ' — stale'}
          </span>
        )}
        <button
          onClick={() => setPartialOnly((v) => !v)}
          className={`ml-auto rounded-xl border px-3 py-1.5 text-sm transition-colors ${
            partialOnly ? 'border-amber-400/50 bg-amber-400/10 text-amber-300' : 'border-line text-muted hover:text-fg'
          }`}
        >
          partial only
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {shown.map((r) => {
          const color = riskColor(r.risk)
          const isOpen = expanded === r.pairKey
          return (
            <div key={r.pairKey}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isOpen ? null : r.pairKey)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setExpanded(isOpen ? null : r.pairKey)
                  }
                }}
                className="glass relative cursor-pointer overflow-hidden rounded-2xl px-4 py-3.5 outline-none transition-colors hover:bg-white/[0.02] focus-visible:ring-1 focus-visible:ring-brand/40 sm:px-5"
              >
                <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
                <div className="flex items-center gap-4">
                  <div className="flex w-16 shrink-0 flex-col items-center" title={GLOSSARY.pairRisk}>
                    <span className="mono text-2xl font-semibold leading-none tabular-nums" style={{ color }}>
                      {r.risk}
                    </span>
                    <span className="mono mt-1 text-[0.56rem] tracking-[0.12em] text-faint">pair risk</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="mono flex flex-wrap items-center gap-x-2.5 text-[0.62rem] uppercase tracking-wider text-faint">
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          r.sameEvent === 'partial' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/[0.06] text-muted'
                        }`}
                      >
                        {r.sameEvent === 'partial' ? 'partial match' : 'same event'}
                      </span>
                      {r.gap != null && <span className="text-fg/80">gap {Math.round(r.gap * 100)}¢</span>}
                      <span title={GLOSSARY.divergence}>divergence {r.base}</span>
                      {r.settlement === 'split' && (
                        <span className="rounded bg-rose-400/15 px-1.5 py-0.5 text-rose-300">SPLIT SETTLEMENT</span>
                      )}
                      {r.settlement === 'identical' && <span className="text-faint">settled identical</span>}
                      {r.settlement === 'divergent-partial' && (
                        <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-300">
                          settled apart (partial pair)
                        </span>
                      )}
                    </div>
                    <LegLine leg={r.kalshi} venue="Kalshi" />
                    <LegLine leg={r.poly} venue="Polymarket" />
                    {r.scenario && (
                      <div className="line-clamp-1 text-[0.82rem] text-muted">
                        <span className="mono text-[0.68rem] uppercase tracking-wider text-faint">splits if · </span>
                        {r.scenario}
                      </div>
                    )}
                  </div>
                  <div className={`mono shrink-0 text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</div>
                </div>
              </div>

              {isOpen && (
                <div className="glass mt-2 space-y-4 rounded-2xl px-5 py-4">
                  {/* L1 hero: the split condition in large type, two venue columns. */}
                  {(r.splitsIfShort || r.scenario) && (
                    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-4">
                      <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-amber-300">splits if</div>
                      <p className="mt-1 text-[1.15rem] font-semibold leading-snug text-fg">
                        {r.splitsIfShort ?? r.scenario}
                      </p>
                      {r.scenarioYesVenue && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="mono rounded-lg border border-line bg-black/20 px-3 py-2 text-xs">
                            Kalshi{' '}
                            <span className={r.scenarioYesVenue === 'kalshi' ? 'font-semibold text-emerald-300' : 'font-semibold text-rose-300'}>
                              → {r.scenarioYesVenue === 'kalshi' ? 'YES' : 'NO'}
                            </span>
                          </div>
                          <div className="mono rounded-lg border border-line bg-black/20 px-3 py-2 text-xs">
                            Polymarket{' '}
                            <span className={r.scenarioYesVenue === 'polymarket' ? 'font-semibold text-emerald-300' : 'font-semibold text-rose-300'}>
                              → {r.scenarioYesVenue === 'polymarket' ? 'YES' : 'NO'}
                            </span>
                          </div>
                        </div>
                      )}
                      {/* Full scenario preserved under the hero when the short line is shown. */}
                      {r.splitsIfShort && r.scenario && (
                        <details className="group mt-3">
                          <summary className="mono cursor-pointer list-none text-[0.68rem] text-amber-300/70 hover:text-amber-300">
                            full scenario ▾
                          </summary>
                          <p className="mt-2 text-[0.86rem] leading-relaxed text-fg/85">{r.scenario}</p>
                        </details>
                      )}
                    </div>
                  )}
                  {r.base >= 45 && (
                    <p className="mono rounded-lg border border-rose-400/25 bg-rose-400/[0.05] px-3 py-2 text-[0.74rem] text-rose-200">
                      Arb warning: do not treat the price gap as risk-free; legs can settle opposite.
                    </p>
                  )}
                  <p className="max-w-3xl text-[0.9rem] leading-relaxed text-fg/90">{r.summary}</p>

                  {/* Matched legs: the same claim on both venues, side by side. */}
                  {r.legPairs.length > 0 && (
                    <div className="rounded-xl border border-line bg-black/20 px-4 py-3">
                      <div className="mono mb-2 text-[0.66rem] uppercase tracking-wider text-faint">
                        matched legs ({r.legPairs.length}) — same claim, both venues
                        {r.legSettled ? ` · ${r.legSettled} settled` : ''}
                        {r.legSplits ? (
                          <span className="text-rose-300"> · {r.legSplits} SPLIT</span>
                        ) : (
                          ''
                        )}
                      </div>
                      <div className="space-y-1">
                        {r.legPairs.map((l) => (
                          <div key={l.label} className="mono flex items-baseline gap-3 text-[0.78rem]">
                            <span className="w-40 shrink-0 truncate text-fg capitalize">{l.kalshi.label}</span>
                            <span className="text-muted">K {cents(l.kalshi.priceYes)}</span>
                            <span className="text-muted">P {cents(l.poly.priceYes)}</span>
                            <span className={l.gap != null && l.gap >= 0.05 ? 'text-amber-300' : 'text-faint'}>
                              gap {l.gap != null ? Math.round(l.gap * 100) + '¢' : '—'}
                            </span>
                            {l.quality === 'fuzzy' && <span className="text-faint">~fuzzy</span>}
                            {l.settlement === 'split' && (
                              <span className="rounded bg-rose-400/15 px-1 text-rose-300">SPLIT</span>
                            )}
                            {l.settlement === 'identical' && <span className="text-faint">settled same</span>}
                            {(l.settlement === 'divergent-partial' || l.settlement === 'non-comparable') && (
                              <span className="text-faint">settled</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Severity items: one-line rows expanding to the dual verbatim quotes. */}
                  {r.items.map((it, i) => (
                    <details key={i} className="group rounded-xl border border-line bg-black/20 px-4 py-3">
                      <summary className="mono flex cursor-pointer list-none items-center gap-2 text-[0.7rem] uppercase tracking-wider">
                        <span className="text-fg">{it.topic}</span>
                        <span className="text-faint">severity {it.severity}</span>
                        <span className="min-w-0 flex-1 truncate normal-case tracking-normal text-muted">
                          {it.explanation}
                        </span>
                        <span className="text-faint transition-transform group-open:rotate-90">›</span>
                      </summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <div className="mono text-[0.6rem] uppercase tracking-wider text-faint">kalshi says</div>
                          <p className="mono mt-1 text-[0.76rem] leading-relaxed text-muted">“{it.kalshi_clause}”</p>
                        </div>
                        <div>
                          <div className="mono text-[0.6rem] uppercase tracking-wider text-faint">polymarket says</div>
                          <p className="mono mt-1 text-[0.76rem] leading-relaxed text-muted">“{it.polymarket_clause}”</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[0.84rem] leading-relaxed text-fg/85">{it.explanation}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {!shown.length && (
          <div className="glass rounded-2xl px-6 py-14 text-center text-sm text-muted">
            {rows.length ? (
              <>No pairs match this filter.</>
            ) : (
              <>
                No confirmed cross-venue pairs yet — run <span className="mono text-fg">npm run crossvenue</span> after
                enrich.
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
