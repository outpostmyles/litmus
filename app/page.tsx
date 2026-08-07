import Link from 'next/link'
import { loadCatalog, loadScores } from '@/src/cache/store'
import { loadTrack } from '@/src/track/store'
import { riskColor, liveRisk, daysUntil, BAND_LABEL, type RiskBand } from '@/lib/litmus'
import { LeanChip, type VerdictData } from '@/components/Verdict'

export const dynamic = 'force-dynamic'

// The landing page answers one question in ten seconds: what should I be worried
// about right now? Everything here is precomputed and served from the local cache —
// no model calls, no waiting.

const HORIZON_DAYS = 75

export default function Home() {
  const catalog = loadCatalog()
  const scores = loadScores()
  const tracked = Object.keys(loadTrack()).length

  const rows = catalog
    .map((e) => {
      const s = scores[e.rulebookHash]
      if (!s) return null
      const d = daysUntil(e.closeDate)
      const live = liveRisk(s.combined, e.priceYes)
      return { e, s, d, live: live ?? s.combined }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)

  // "Worry about this": genuinely risky text, near enough to matter, and priced so
  // the gray zone can still bite. Sorted by live risk (hazard x trigger likelihood).
  const traps = rows
    .filter((r) => r.d != null && r.d > 0 && r.d <= HORIZON_DAYS && r.s.combined >= 45 && r.live >= 25)
    .sort((a, b) => b.live - a.live)
    .slice(0, 3)

  const scored = rows.length
  const flagged = rows.filter((r) => r.s.combined >= 45).length

  return (
    <div className="mx-auto max-w-4xl">
      <section className="pb-8 pt-4">
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-[2.6rem]">
          Prediction-market prices track the event.
          <br className="hidden sm:block" /> Contracts pay out on the rules text.
        </h1>
        <p className="mt-4 max-w-2xl text-[1.02rem] leading-relaxed text-muted">
          The gap between those two things is measurable risk that no venue surfaces. Litmus reads the settlement
          rules on {scored} live Kalshi and Polymarket markets, flags where the fine print can diverge from what
          traders assume, and{' '}
          <Link href="/track" className="text-fg underline decoration-line underline-offset-4 hover:decoration-brand">
            grades every call it makes
          </Link>{' '}
          when the market settles.
        </p>
        <div className="mono mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-faint">
          <span>
            <span className="text-fg">9/12</span> disputes caught in a blind backtest (75%, 95% CI 47–91%)
          </span>
          <span>
            <span className="text-fg">{flagged}</span> of {scored} live markets flagged
          </span>
          <span>
            <span className="text-fg">{tracked}</span> predictions locked and self-graded
          </span>
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-fg">What to watch right now</h2>
          <Link href="/board" className="mono text-xs text-faint transition-colors hover:text-brand">
            all {scored} markets →
          </Link>
        </div>
        <p className="mt-1 text-[0.88rem] text-muted">
          Highest live risk among flagged markets closing within {HORIZON_DAYS} days — the text is ambiguous
          <em> and</em> the price leaves room for it to matter.
        </p>

        <div className="mt-4 space-y-3">
          {traps.map(({ e, s, d, live }) => {
            const color = riskColor(live)
            return (
              <article key={e.rulebookHash} className="glass relative overflow-hidden rounded-2xl px-5 py-4">
                <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
                <div className="flex items-start gap-4">
                  <div className="flex w-14 shrink-0 flex-col items-center">
                    <span className="mono text-2xl font-semibold leading-none tabular-nums" style={{ color }}>
                      {live}
                    </span>
                    <span className="mono mt-1 text-[0.52rem] tracking-[0.14em] text-faint">LIVE RISK</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mono flex flex-wrap items-center gap-x-2.5 text-[0.62rem] uppercase tracking-wider text-faint">
                      <span>{e.platform}</span>
                      {e.priceYes != null && <span className="text-fg/80">Yes {Math.round(e.priceYes * 100)}¢</span>}
                      {d != null && <span>{d < 1 ? 'closes today' : `${Math.round(d)}d to close`}</span>}
                      <span style={{ color }}>{BAND_LABEL[s.band as RiskBand] ?? s.band}</span>
                    </div>
                    <h3 className="mt-1 text-[1.02rem] font-medium leading-snug text-fg">{e.question}</h3>
                    {s.verdict && (
                      <div className="mt-2 flex flex-wrap items-baseline gap-2">
                        <LeanChip v={s.verdict as VerdictData} size="sm" />
                        <span className="text-[0.9rem] text-muted">
                          <span className="mono mr-1 text-[0.62rem] uppercase tracking-wider text-faint">trap:</span>
                          {s.verdict.trap_phrase}
                        </span>
                      </div>
                    )}
                    {s.verdict?.killer_clause && (
                      <p className="mono mt-2 border-l-2 pl-3 text-[0.78rem] leading-relaxed text-muted" style={{ borderColor: color }}>
                        “{s.verdict.killer_clause}”
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
          {traps.length === 0 && (
            <div className="glass rounded-2xl px-6 py-10 text-center text-sm text-muted">
              Nothing flagged is closing soon — check the{' '}
              <Link href="/board" className="text-brand">
                board
              </Link>{' '}
              for the full ranked universe.
            </div>
          )}
        </div>
      </section>

      <section className="mt-10 grid gap-3 sm:grid-cols-3">
        {[
          { href: '/board', title: 'The board', body: `All ${scored} scored markets, ranked by live risk, with the clause that creates each trap.` },
          { href: '/track', title: 'The record', body: 'Every prediction locked while the market was open, then graded on settlement — losses included.' },
          { href: '/cases', title: 'The evidence', body: '13 real settlement disputes scored blind on pre-settlement text. It caught 9 of 12.' },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="glass rounded-2xl px-4 py-4 transition-colors hover:border-brand/30">
            <div className="text-[0.95rem] font-medium text-fg">{c.title}</div>
            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-muted">{c.body}</p>
          </Link>
        ))}
      </section>

      <p className="mono mt-8 text-center text-xs text-faint">
        Want to score a specific market?{' '}
        <Link href="/lookup" className="text-brand">
          Look one up →
        </Link>
      </p>
    </div>
  )
}
