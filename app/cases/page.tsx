import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FixtureSchema, FIXTURE_DIR, type Fixture } from '@/src/backtest/fixtures'
import { DIMENSION_LABELS, type Dimension } from '@/src/engine/weights'
import { riskColor, BAND_LABEL, type RiskBand } from '@/lib/litmus'

// Every card is a real, documented dispute or controversial settlement. The score shown
// is Litmus's BLIND read of the original pre-settlement rules — the engine never saw the
// outcome. This page is rendered entirely from committed fixtures + the recorded backtest
// artifact: no API key, no model calls.

interface CaseScore {
  combined: number
  band: string
  reasonHit?: { hit: number; of: number }
}

/**
 * Tolerant fixture loader for display: a single malformed fixture is skipped, not
 * fatal — this page prerenders at build time, and one bad JSON file must not take
 * down the whole build. (The backtest runner keeps the strict loader on purpose.)
 */
function loadFixturesTolerant(): Fixture[] {
  let files: string[]
  try {
    files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: Fixture[] = []
  for (const f of files.sort()) {
    try {
      out.push(FixtureSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8'))))
    } catch {
      /* skip the bad file; the rest of the gallery still renders */
    }
  }
  return out
}

function loadArtifactScores(): Map<string, CaseScore> {
  const map = new Map<string, CaseScore>()
  try {
    const artifact = JSON.parse(readFileSync('data/backtest-results.json', 'utf8'))
    const dimFlag = Number(artifact.dimFlag) || 50
    for (const c of artifact.cases ?? []) {
      // Reason-hit: how many of the dispute's known failure dimensions the engine
      // independently flagged (≥ dimFlag). Derived from the per-dimension scores the
      // backtest runner records.
      let reasonHit: CaseScore['reasonHit']
      if (Array.isArray(c.dimensions) && Array.isArray(c.expectedDimensions) && c.expectedDimensions.length) {
        const flagged = new Set(
          c.dimensions.filter((d: any) => Number(d.score) >= dimFlag).map((d: any) => String(d.key)),
        )
        const hit = c.expectedDimensions.filter((d: string) => flagged.has(d)).length
        reasonHit = { hit, of: c.expectedDimensions.length }
      } else if (c.reasonHit) {
        reasonHit = c.reasonHit
      }
      map.set(String(c.caseId), { combined: Number(c.combined), band: String(c.band), reasonHit })
    }
  } catch {
    /* artifact missing — cards render without scores */
  }
  return map
}

function DimChip({ d }: { d: string }) {
  const label = DIMENSION_LABELS[d as Dimension] ?? d
  return (
    <span className="mono rounded-md border border-line bg-white/[0.03] px-2 py-0.5 text-[0.66rem] tracking-wide text-muted">
      {label}
    </span>
  )
}

export const metadata = { title: 'Litmus — case studies' }

export default function CasesPage() {
  const scores = loadArtifactScores()
  const fixtures = loadFixturesTolerant()

  const withScore = fixtures.map((f) => ({
    f,
    s: scores.get(f.label.caseId) ?? null,
    isControl: f.label.textDetectable.toUpperCase().startsWith('WEAK'),
  }))
  // Detectable disputes by blind score (desc); the control last — it's the punchline.
  withScore.sort((a, b) => {
    if (a.isControl !== b.isControl) return a.isControl ? 1 : -1
    return (b.s?.combined ?? 0) - (a.s?.combined ?? 0)
  })

  const hasScores = scores.size > 0
  const flagged = withScore.filter((c) => !c.isControl && (c.s?.combined ?? 0) >= 45).length
  const detectable = withScore.filter((c) => !c.isControl).length
  const controls = withScore.filter((c) => c.isControl)
  const controlsUnflagged = controls.filter((c) => (c.s?.combined ?? 0) < 45).length
  // Derived from the artifact, not asserted — if a future run flags a control, the
  // sentence tells the truth about it.
  const controlSentence =
    controls.length === 0
      ? ''
      : controlsUnflagged === controls.length
        ? ` — and correctly left the ${controls.length === 1 ? 'control case' : `${controls.length} control cases`} (mis-settled for reasons outside the text) unflagged`
        : ` — while flagging ${controls.length - controlsUnflagged} of ${controls.length} control cases it should have left clean`

  return (
    <div className="mx-auto max-w-4xl">
      <section className="pb-7 pt-4">
        <div className="label">the gold-set</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Would we have caught it?</h1>
        <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
          Every case below is a real prediction market that <span className="text-fg">blew up on resolution</span> —
          traders read the question one way, the fine print settled another. Litmus scored each one{' '}
          <span className="text-fg">blind</span>: only the original pre-settlement rules text, never the outcome or
          the news of what went wrong.
          {hasScores ? (
            <>
              {' '}
              It flagged {flagged} of the {detectable} disputes whose ambiguity lived in the text
              {controlSentence}.
            </>
          ) : (
            <> Blind scores appear once data/backtest-results.json is present (run npm run backtest).</>
          )}
        </p>
        <p className="mono mt-3 text-xs text-faint">
          blind score ≥45 = flagged (the elevated band) · methodology + confidence intervals in docs/BACKTEST.md
        </p>
      </section>

      <div className="space-y-5">
        {withScore.map(({ f, s, isControl }) => {
          const color = s ? riskColor(s.combined) : 'var(--color-line)'
          return (
            <article key={f.label.caseId} className="glass relative overflow-hidden rounded-3xl">
              <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mono flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.62rem] uppercase tracking-wider text-faint">
                      <span>{f.market.platform}</span>
                      <span className="text-faint/70">{f.label.caseId}</span>
                      {isControl ? (
                        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-muted">control — clean text</span>
                      ) : (
                        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-muted">real dispute</span>
                      )}
                      {/* Say plainly whether the engine caught this one. An unlabeled
                          low score at the bottom of the page reads as a quiet failure;
                          a labeled miss reads as a disclosed limitation. */}
                      {s &&
                        (isControl ? (
                          s.combined < 45 ? (
                            <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-emerald-300">
                              correctly not flagged
                            </span>
                          ) : (
                            <span className="rounded bg-rose-400/10 px-1.5 py-0.5 text-rose-300">false alarm</span>
                          )
                        ) : s.combined >= 45 ? (
                          <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-emerald-300">caught</span>
                        ) : (
                          <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-300">
                            missed — scored below the 45 line
                          </span>
                        ))}
                    </div>
                    <h2 className="mt-1.5 text-lg font-semibold leading-snug text-fg sm:text-xl">
                      {f.market.question}
                    </h2>
                  </div>
                  {s && (
                    <div className="flex shrink-0 flex-col items-center">
                      <span className="mono text-4xl font-semibold leading-none tabular-nums" style={{ color }}>
                        {s.combined}
                      </span>
                      <span className="mono mt-1 text-[0.56rem] tracking-[0.14em]" style={{ color }}>
                        {BAND_LABEL[s.band as RiskBand] ?? s.band}
                      </span>
                      <span className="mono mt-0.5 text-[0.56rem] tracking-wider text-faint">blind</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-line bg-black/20 px-4 py-3.5">
                  <div className="label">what actually happened</div>
                  <p className="mt-1.5 text-[0.9rem] leading-relaxed text-fg/90">{f.label.whatHappened}</p>
                  {f.label.source && (
                    <a
                      href={f.label.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono mt-2 inline-block text-xs text-faint underline decoration-line underline-offset-4 transition-colors hover:text-brand"
                    >
                      source ↗
                    </a>
                  )}
                </div>

                {f.label.expectedDimensions.length > 0 && (
                  <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                    <span className="mono mr-1 text-[0.66rem] uppercase tracking-wider text-faint">
                      known failure modes
                    </span>
                    {f.label.expectedDimensions.map((d) => (
                      <DimChip key={d} d={d} />
                    ))}
                    {s?.reasonHit && !isControl && (
                      <span className="mono ml-1 text-[0.66rem] text-muted">
                        engine independently flagged {s.reasonHit.hit}/{s.reasonHit.of}
                      </span>
                    )}
                  </div>
                )}

                <details className="group mt-4">
                  <summary className="mono cursor-pointer list-none text-xs text-faint transition-colors hover:text-muted">
                    view the pre-settlement rules the engine scored
                  </summary>
                  <p className="mono mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-black/20 p-4 text-[0.76rem] leading-relaxed text-muted">
                    {f.market.resolutionText}
                  </p>
                </details>
              </div>
            </article>
          )
        })}
      </div>

      <p className="mono mt-8 pb-4 text-center text-xs text-faint">
        fixtures are committed verbatim in data/fixtures/backtest · reproduce with npm run backtest
      </p>
    </div>
  )
}
