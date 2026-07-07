import { loadCatalog, loadScores } from '@/src/cache/store'
import { riskColor, liveRisk, fmtVolume, ageOf, BAND_LABEL, type RiskBand } from '@/lib/litmus'
import { LeanChip, type VerdictData } from '@/components/Verdict'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Litmus — World Cup settlement traps' }

// The tournament page: every scored World Cup market family ranked by LIVE risk
// (text hazard × how likely the gray zone is to matter at the current price),
// with the legs table and the settlement-trap explainer. Server-rendered from the
// local cache — zero model calls per request.

const TRAPS = [
  {
    title: 'Extra time and penalties',
    body: 'Knockout markets often define a "win" for 90 minutes plus stoppage only — a team that advances on penalties may not "win the match" as the rules define it. Check which definition your contract uses before assuming the intuitive one.',
  },
  {
    title: 'The official source',
    body: 'FIFA\'s official record, a named data provider, and "a consensus of credible reporting" can disagree on awarded goals, own-goal attribution, and abandoned-match outcomes. A market without one named source carries dispute surface even when the football is unambiguous.',
  },
  {
    title: 'Timing clauses',
    body: 'Deadlines pinned to a calendar date instead of the fixture ("by July 19") break when a match is postponed or suspended — the event can happen and the market can still miss its window.',
  },
  {
    title: 'Award markets are committee markets',
    body: 'Golden Boot / Best Player markets resolve on tie-breaker rules (assists, minutes played) and official award announcements — a scoring tie is exactly where fine print decides who gets paid.',
  },
]

export default function WorldCupPage() {
  const catalog = loadCatalog()
  const scores = loadScores()
  const rows = catalog
    .filter((e) => e.category === 'World Cup' || /world cup|fifa/i.test(e.question))
    .map((e) => {
      const s = scores[e.rulebookHash]
      return {
        e,
        s,
        live: s ? (liveRisk(s.combined, e.priceYes) ?? s.combined) : null,
      }
    })
    .filter((r) => r.s)
    .sort((a, b) => (b.live ?? 0) - (a.live ?? 0))

  const freshest = rows.reduce<string | null>((acc, r) => {
    const p = r.e.priceAsOf
    return p && (!acc || p > acc) ? p : acc
  }, null)
  const priceAge = ageOf(freshest)

  return (
    <div className="mx-auto max-w-4xl">
      <section className="pb-7 pt-4">
        <div className="label">tournament mode</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">World Cup settlement traps</h1>
        <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
          Every scored World Cup market family, ranked by <span className="text-fg">live risk</span> — how badly the
          written rules can diverge from what the football says, weighted by whether the price leaves room for it to
          matter. The tournament is decided on the pitch; your payout is decided by the fine print.
        </p>
        {priceAge && <p className="mono mt-2 text-xs text-faint">prices as of {priceAge}</p>}
      </section>

      {rows.length === 0 && (
        <div className="glass rounded-2xl px-6 py-14 text-center text-sm text-muted">
          No World Cup families scored yet — run <span className="mono text-fg">npm run worldcup</span>.
        </div>
      )}

      <div className="space-y-3">
        {rows.map(({ e, s, live }) => {
          const color = riskColor(live ?? s!.combined)
          const topLegs = (e.legs ?? []).slice().sort((a, b) => b.volume - a.volume).slice(0, 8)
          return (
            <article key={e.rulebookHash} className="glass relative overflow-hidden rounded-2xl px-5 py-4">
              <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
              <div className="flex items-start gap-4">
                <div className="flex w-16 shrink-0 flex-col items-center">
                  <span className="mono text-2xl font-semibold leading-none tabular-nums" style={{ color }}>
                    {live ?? s!.combined}
                  </span>
                  <span className="mono mt-1 text-[0.56rem] tracking-[0.12em] text-faint">live risk</span>
                  <span className="mono mt-0.5 text-[0.56rem] tracking-[0.12em]" style={{ color }}>
                    {BAND_LABEL[s!.band as RiskBand] ?? s!.band} {s!.combined}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mono flex flex-wrap items-center gap-x-2.5 text-[0.62rem] uppercase tracking-wider text-faint">
                    <span>{e.platform}</span>
                    {e.marketCount > 1 && <span>{e.marketCount} legs</span>}
                    <span>{fmtVolume(e.platform, e.totalVolume)}</span>
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-brand">
                        open ↗
                      </a>
                    )}
                  </div>
                  <h2 className="mt-0.5 text-lg font-semibold leading-snug text-fg">{e.question}</h2>
                  {s!.verdict && (
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-2">
                      <LeanChip v={s!.verdict as VerdictData} size="sm" />
                      <span className="truncate text-[0.85rem] text-muted">
                        <span className="mono mr-1 text-[0.62rem] uppercase tracking-wider text-faint">trap:</span>
                        {s!.verdict.trap_phrase}
                      </span>
                    </div>
                  )}
                  {s!.verdict?.killer_clause && (
                    <p className="mono mt-2 max-w-3xl border-l-2 border-amber-400/40 pl-3 text-[0.78rem] leading-relaxed text-muted">
                      “{s!.verdict.killer_clause}”
                    </p>
                  )}
                  {topLegs.length > 0 && (
                    <div className="mono mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.74rem] text-muted">
                      {topLegs.map((l) => (
                        <span key={l.marketId}>
                          {l.label}{' '}
                          <span className="text-fg/80">{l.priceYes != null ? Math.round(l.priceYes * 100) + '¢' : '—'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <section className="mt-10">
        <div className="label">the trap classes</div>
        <h2 className="mt-2 text-xl font-semibold text-fg">How World Cup markets go sideways</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {TRAPS.map((t) => (
            <div key={t.title} className="glass rounded-2xl px-4 py-3.5">
              <div className="text-[0.95rem] font-medium text-fg">{t.title}</div>
              <p className="mt-1.5 text-[0.86rem] leading-relaxed text-muted">{t.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
