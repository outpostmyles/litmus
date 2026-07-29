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
  disputeSeen: string | null
  process: 'clean' | 'delayed' | 'contested' | 'split' | 'void' | null
  surprise?: 'surprise' | 'clean' | 'tossup' | null
  edge?: { result: 'win' | 'loss' | 'push'; pnl: number } | null
}

interface Interval {
  low: number
  high: number
}
interface Payload {
  minSample: number
  counts: { tracked: number; resolved: number; pending: number }
  sim: {
    wins: number
    losses: number
    pushes: number
    pnl: number
    decided: number
    winRate: number | null
    winRateCI: Interval | null
    enoughSample: boolean
    byVersion: Record<string, { wins: number; losses: number; pushes: number; pnl: number }>
    pendingByVersion: Record<string, number>
  }
  calibration: {
    tp: number
    fp: number
    fn: number
    tn: number
    graded: number
    recall: number | null
    recallN: number
    recallCI: Interval | null
    precision: number | null
    precisionN: number
    precisionCI: Interval | null
    enoughSample: boolean
    gradedMid: number
    gradedExtreme: number
  }
  process: {
    flagged: { sideways: number; clean: number }
    unflagged: { sideways: number; clean: number }
    liveDisputes: number
  }
  baseline: { n: number; crowd: number; litmus: number } | null
  resolvedRows: Row[]
  pendingRows: Row[]
}

const pct = (n: number | null) => (n == null ? '—' : Math.round(n * 100) + '%')
const ci = (i: Interval | null) => (i ? `95% CI ${pct(i.low)}–${pct(i.high)}` : '')
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
      {foot && (
        <details className="group mt-3">
          <summary className="mono cursor-pointer list-none text-[0.68rem] text-faint transition-colors hover:text-muted">
            methodology ▾
          </summary>
          <div className="mono mt-1.5 text-[0.7rem] leading-relaxed text-faint">{foot}</div>
        </details>
      )}
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

  if (loading && !data)
    return (
      <div className="glass rounded-2xl px-6 py-16 text-center text-sm text-muted">
        Loading the track record — every prediction Litmus locked, graded against what actually settled.
      </div>
    )
  if (error) return <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
  if (!data) return null

  const { minSample, counts, sim, calibration, process, baseline, resolvedRows, pendingRows } = data
  const sidewaysTotal = process.flagged.sideways + process.unflagged.sideways
  const pnlColor = sim.pnl > 0 ? 'text-emerald-300' : sim.pnl < 0 ? 'text-rose-300' : 'text-fg'

  return (
    <div>
      {/* What the ledger PROVES, stated before what it scores. Every one of these is a
          structural fact, not a result that could swing next week. */}
      <div className="glass mb-3 rounded-2xl px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          {[
            { n: counts.tracked, l: 'predictions locked' },
            { n: counts.resolved, l: 'graded on settlement' },
            { n: 0, l: 'ever rewritten' },
          ].map((s) => (
            <div key={s.l}>
              <div className="mono text-2xl font-semibold tabular-nums text-fg">{s.n}</div>
              <div className="mono mt-0.5 text-[0.62rem] uppercase tracking-wider text-faint">{s.l}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 max-w-2xl text-[0.86rem] leading-relaxed text-muted">
          Each call is locked while the market is still open — score, band, side and entry price — then graded
          automatically against the venue&rsquo;s own settlement, with the status string that produced the outcome
          stored on the row. Closed, stale-priced and unverifiable markets are refused at lock time. Nothing below
          was written after the fact.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="edge simulation"
          foot="1-unit paper trade on each flagged edge, entered at the open-market price when flagged. Calls are segmented by the rule that made them: v2 is the retired rule (it minted penny-longshot 'edges'), v3 requires a quotable clause and a price the crowd hasn't already read correctly. Locked calls are never rewritten, so the old rule's record stays visible rather than being quietly deleted."
        >
          {/* Deliberately NOT an aggregate across rule generations — that number
              describes no rule that actually runs. Each generation stands alone. */}
          {sim.decided > 0 ? (
            <div className="space-y-2">
              {['3', '2'].map((v) => {
                const s = sim.byVersion[v]
                const open = sim.pendingByVersion[v] ?? 0
                if (!s && !open) return null
                const dec = s ? s.wins + s.losses : 0
                const cur = v === '3'
                return (
                  <div key={v}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`mono ${cur ? 'text-xl text-fg' : 'text-sm text-muted'} font-semibold`}>
                        {dec > 0 ? `${s!.wins}–${s!.losses}` : '—'}
                      </span>
                      <span className={`mono ${cur ? 'text-base' : 'text-xs'} font-semibold ${s && s.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {s ? `${signed(s.pnl)}u` : ''}
                      </span>
                    </div>
                    <div className="mono mt-0.5 text-[0.62rem] uppercase tracking-wider text-faint">
                      {cur ? 'current rule' : 'retired rule'} · {open} open
                      {dec > 0 && dec < minSample ? ` · n=${dec}` : ''}
                    </div>
                  </div>
                )
              })}
              <div className="mono pt-1 text-[0.68rem] text-faint">
                win rate reported at n={minSample}
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted">no edges resolved yet</span>
          )}

        </Stat>

        <Stat
          label="risk calibration"
          foot="graded two ways: price surprises (did a confident price flip) and process (did settlement itself go sideways — dispute, void, split, long delay). Extreme-priced entries can't flip, so they're counted apart."
        >
          {calibration.graded > 0 ? (
            <>
              {calibration.enoughSample ? (
                <>
                  <span className="mono text-3xl font-semibold text-fg">{pct(calibration.recall)}</span>
                  <div className="mono mt-1 text-xs text-muted">recall · {ci(calibration.recallCI)}</div>
                </>
              ) : (
                <span className="mono text-lg font-semibold text-faint">building sample</span>
              )}
              <div className="mono mt-1 text-xs text-muted">
                {calibration.tp}/{calibration.recallN} surprises caught · {calibration.fp} false alarm
                {calibration.fp === 1 ? '' : 's'} · {calibration.gradedMid} gradeable + {calibration.gradedExtreme}{' '}
                extreme-priced
              </div>
              <div className="mono mt-1 text-xs text-muted">
                process: {sidewaysTotal} sideways ({process.flagged.sideways} flagged)
                {process.liveDisputes > 0 && (
                  <span className="text-amber-300"> · {process.liveDisputes} live dispute{process.liveDisputes === 1 ? '' : 's'}</span>
                )}
              </div>
            </>
          ) : (
            <span className="text-sm text-muted">no resolutions yet</span>
          )}
        </Stat>

        <Stat
          label="coverage"
          foot="baseline = Brier score of the locked entry price alone vs the price shifted 10% toward the rules-favored side on locked edges. Lower is better; beating the crowd is the whole game."
        >
          <div className="mono text-3xl font-semibold text-fg">{counts.resolved}</div>
          <div className="mono mt-1 text-xs text-muted">
            resolved · {counts.pending} open · {counts.tracked} tracked
          </div>
          {baseline && (
            <div
              className="mono mt-1 text-xs text-muted"
              title="Brier: accuracy score for probability forecasts — lower is better; Litmus has to beat the raw market price."
            >
              brier — crowd {baseline.crowd.toFixed(4)} · litmus {baseline.litmus.toFixed(4)} · n={baseline.n}
            </div>
          )}
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
                      {r.process && r.process !== 'clean' && (
                        <span className="rounded bg-amber-400/10 px-1 py-0.5 text-amber-300">{r.process}</span>
                      )}
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
                      {r.disputeSeen && (
                        <span className="rounded bg-amber-400/10 px-1 py-0.5 text-amber-300">disputed</span>
                      )}
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
