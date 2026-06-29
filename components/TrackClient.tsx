'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { riskColor, BAND_LABEL, type RiskBand } from '@/lib/litmus'

interface Row {
  hash: string
  platform: string
  question: string
  combined: number
  band: RiskBand
  edgeSide: 'yes' | 'no' | null
  entryPriceYes: number | null
  closeDate: string | null
  outcome: 'yes' | 'no' | 'other' | 'void' | null
  finalPriceYes: number | null
  resolvedAt: string | null
  surprise?: 'surprise' | 'clean' | 'tossup' | null
  edge?: { result: 'win' | 'loss' | 'push'; pnl: number } | null
}

interface Payload {
  counts: { tracked: number; resolved: number; pending: number }
  sim: { wins: number; losses: number; pushes: number; pnl: number; decided: number; winRate: number | null }
  calibration: { tp: number; fp: number; fn: number; tn: number; recall: number | null; precision: number | null }
  resolvedRows: Row[]
  pendingRows: Row[]
}

const pct = (n: number | null) => (n == null ? '—' : Math.round(n * 100) + '%')
const cents = (p: number | null | undefined) => (p == null ? '—' : Math.round(p * 100) + '¢')
const signed = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)
function closesIn(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'closing'
  if (days === 0) return 'today'
  if (days < 60) return days + 'd'
  if (days < 720) return Math.round(days / 30) + 'mo'
  return Math.round(days / 365) + 'y'
}
const OUTCOME_COLOR: Record<string, string> = {
  yes: 'text-emerald-300',
  no: 'text-rose-300',
  other: 'text-amber-300',
  void: 'text-muted',
}

function Stat({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="label">{label}</div>
      <div className="mt-2">{children}</div>
      {foot && <div className="mono mt-3 text-[0.7rem] leading-relaxed text-faint">{foot}</div>}
    </div>
  )
}

function EdgeChip({ side }: { side: 'yes' | 'no' }) {
  return (
    <span className="mono rounded bg-brand/15 px-1.5 py-0.5 text-[0.6rem] text-brand">rules → {side === 'yes' ? 'Yes' : 'No'}</span>
  )
}

export function TrackClient() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/track', { cache: 'no-store' })
      const json = (await res.json()) as Payload
      if (!res.ok) throw new Error('Failed to load track record.')
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  if (loading && !data) return <div className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted">Loading track record…</div>
  if (error) return <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
  if (!data) return null

  const { counts, sim, calibration, resolvedRows, pendingRows } = data
  const pnlColor = sim.pnl > 0 ? 'text-emerald-300' : sim.pnl < 0 ? 'text-rose-300' : 'text-fg'

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="edge simulation"
          foot="1-unit paper trade on each flagged edge, entered at the price when flagged."
        >
          {sim.decided > 0 ? (
            <div className="flex items-baseline justify-between">
              <span className="mono text-3xl font-semibold text-fg">
                {sim.wins}–{sim.losses}
              </span>
              <span className={`mono text-2xl font-semibold ${pnlColor}`}>{signed(sim.pnl)}u</span>
            </div>
          ) : (
            <span className="text-sm text-muted">no edges resolved yet</span>
          )}
          {sim.decided > 0 && (
            <div className="mono mt-1 text-xs text-muted">
              {pct(sim.winRate)} win rate{sim.pushes ? ` · ${sim.pushes} push` : ''}
            </div>
          )}
        </Stat>

        <Stat label="risk calibration" foot="does a high score actually predict a surprising resolution?">
          {counts.resolved > 0 ? (
            <>
              <span className="mono text-3xl font-semibold text-fg">{pct(calibration.recall)}</span>
              <div className="mono mt-1 text-xs text-muted">
                caught {calibration.tp} of {calibration.tp + calibration.fn} surprises · {calibration.fp} false alarm
                {calibration.fp === 1 ? '' : 's'}
              </div>
            </>
          ) : (
            <span className="text-sm text-muted">no resolutions yet</span>
          )}
        </Stat>

        <Stat label="coverage" foot="resolutions settle automatically each day, or run npm run settle.">
          <div className="mono text-3xl font-semibold text-fg">{counts.resolved}</div>
          <div className="mono mt-1 text-xs text-muted">
            resolved · {counts.pending} open · {counts.tracked} tracked
          </div>
        </Stat>
      </div>

      {/* resolved log */}
      {resolvedRows.length > 0 && (
        <>
          <div className="label mt-9 mb-3">resolved</div>
          <div className="space-y-2.5">
            {resolvedRows.map((r) => {
              const color = riskColor(r.combined)
              return (
                <div key={r.hash} className="glass relative flex items-center gap-4 overflow-hidden rounded-2xl px-4 py-3 sm:px-5">
                  <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
                  <div className="flex w-12 shrink-0 flex-col items-center">
                    <span className="mono text-lg font-semibold leading-none" style={{ color }}>
                      {r.combined}
                    </span>
                    <span className="mono mt-1 text-[0.5rem] tracking-wider" style={{ color }}>
                      {BAND_LABEL[r.band]}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mono flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.6rem] uppercase tracking-wider text-faint">
                      <span>{r.platform}</span>
                      <span>entry {cents(r.entryPriceYes)}</span>
                      {r.edgeSide && <EdgeChip side={r.edgeSide} />}
                    </div>
                    <div className="truncate text-[0.92rem] font-medium text-fg">{r.question}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <span className={`mono text-sm font-semibold uppercase ${OUTCOME_COLOR[r.outcome ?? 'void']}`}>
                      {r.outcome ?? '—'}
                    </span>
                    <div className="mono flex items-center gap-2 text-[0.62rem] uppercase tracking-wider">
                      {r.surprise === 'surprise' && <span className="text-amber-300">surprise</span>}
                      {r.surprise === 'clean' && <span className="text-faint">clean</span>}
                      {r.edge && (
                        <span
                          className={
                            r.edge.result === 'win'
                              ? 'text-emerald-300'
                              : r.edge.result === 'loss'
                                ? 'text-rose-300'
                                : 'text-faint'
                          }
                        >
                          {r.edge.result} {signed(r.edge.pnl)}u
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* empty state */}
      {resolvedRows.length === 0 && (
        <div className="glass mt-6 rounded-2xl px-6 py-10 text-center">
          <p className="text-sm text-fg">No markets have resolved yet.</p>
          <p className="mt-2 text-sm text-muted">
            Tracking {counts.tracked} predictions. The record fills in as they close — the nearest resolves in{' '}
            <span className="text-fg">{pendingRows[0] ? closesIn(pendingRows[0].closeDate) : '—'}</span>.
          </p>
          <p className="mono mt-3 text-xs text-faint">resolutions settle automatically each day · or run npm run settle</p>
        </div>
      )}

      {/* pending */}
      {pendingRows.length > 0 && (
        <>
          <div className="label mb-3 mt-9">open · resolving soon</div>
          <div className="space-y-2.5">
            {pendingRows.slice(0, 12).map((r) => {
              const color = riskColor(r.combined)
              return (
                <div key={r.hash} className="glass relative flex items-center gap-4 overflow-hidden rounded-2xl px-4 py-3 sm:px-5">
                  <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
                  <div className="mono w-12 shrink-0 text-center text-lg font-semibold" style={{ color }}>
                    {r.combined}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mono flex flex-wrap items-center gap-x-2.5 text-[0.6rem] uppercase tracking-wider text-faint">
                      <span>{r.platform}</span>
                      <span>entry {cents(r.entryPriceYes)}</span>
                      {r.edgeSide && <EdgeChip side={r.edgeSide} />}
                    </div>
                    <div className="truncate text-[0.92rem] font-medium text-fg">{r.question}</div>
                  </div>
                  <div className="mono shrink-0 text-xs text-faint">{closesIn(r.closeDate)}</div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
