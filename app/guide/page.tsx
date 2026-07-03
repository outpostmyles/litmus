import type { ReactNode } from 'react'
import Link from 'next/link'
import { riskColor, BAND_LABEL, BAND_BLURB, type RiskBand } from '@/lib/litmus'

function Section({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-9">
      <div className="label">{label}</div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-[1.7rem]">{title}</h2>
      <div className="mt-4 space-y-4 text-[0.97rem] leading-relaxed text-muted">{children}</div>
    </section>
  )
}

const DIMENSIONS: { name: string; desc: string }[] = [
  { name: 'Source clarity', desc: 'Is the source of truth named and authoritative — or is it "vibes"? No named source is the single biggest red flag.' },
  { name: 'Criteria precision', desc: 'Is the threshold or event defined exactly? Undefined magnitudes ("a cut"), rounding, missing timezones, "by end of month" with no cutoff.' },
  { name: 'Literal-vs-intuitive gap', desc: 'Would a casual trader assume a different outcome than the literal text dictates? Announcement vs. signing, "wins" vs. "is certified". This is where the money lives.' },
  { name: 'Timing risk', desc: 'Can the resolving event be delayed, postponed, extended, or contested in time?' },
  { name: 'Dispute surface', desc: 'Does resolution require subjective judgment, or admit multiple plausible readings of the same clause?' },
]

const BANDS: { band: RiskBand; score: number }[] = [
  { band: 'low', score: 12 },
  { band: 'moderate', score: 35 },
  { band: 'elevated', score: 55 },
  { band: 'high', score: 75 },
  { band: 'severe', score: 92 },
]

const COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: 'npm run dev', desc: 'Start the web app at localhost:3000 (Lookup, Board, Guide).' },
  { cmd: 'npm run ingest', desc: 'Pull the high-volume markets + live prices into the cache. Free, no model calls.' },
  { cmd: 'npm run backfill', desc: 'Score any not-yet-cached markets once (~$0.05 each). Resumable.' },
  { cmd: 'npm run enrich', desc: 'Add the directional lean to scored markets (cheap, Haiku).' },
  { cmd: 'npm run alerts', desc: 'Print urgent items + fire a macOS notification. Runs daily on its own.' },
  { cmd: 'npm run score -- --kalshi KXELONMARS-99', desc: 'Score one live market by ticker, slug, or URL.' },
  { cmd: 'npm run scan -- --kalshi --category Politics', desc: 'Live-score a category on the fly (no cache).' },
  { cmd: 'npm run backtest', desc: 'Re-run the validation against the dispute gold-set.' },
]

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="pb-4 pt-4">
        <div className="label">the guide</div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-[2.7rem]">How Litmus works</h1>
        <p className="mt-4 text-[1.05rem] leading-relaxed text-muted">
          Resolution is the part of prediction markets that actually blows up — a market settles on a clause nobody
          read. Litmus reads the resolution criteria on live Kalshi and Polymarket markets and scores how likely each
          one is to settle <span className="text-fg">differently than traders expect</span>.
        </p>
      </section>

      <div className="space-y-9">
        <Section label="the idea" title="It scores the rules, not the event">
          <p>
            Litmus is not predicting whether the event happens. It&rsquo;s pricing the risk that{' '}
            <span className="text-fg">resolution itself goes sideways</span> — that the written outcome and the assumed
            outcome diverge. A market can be a near-certain &ldquo;Yes&rdquo; on the event and still be a deathtrap on
            resolution.
          </p>
          <p>
            Every market&rsquo;s resolution text is read by Claude on a five-point rubric, then combined into a single
            0&ndash;100 risk score with the exact offending clause quoted back to you.
          </p>
        </Section>

        <Section label="the score" title="One number, five dimensions">
          <p>The combined score lands in one of five bands — and the whole UI takes its color from it:</p>
          <div className="flex flex-col gap-2">
            {BANDS.map(({ band, score }) => (
              <div key={band} className="flex items-center gap-3 rounded-xl border border-line bg-black/20 px-3.5 py-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: riskColor(score) }} />
                <span className="mono w-24 shrink-0 text-xs uppercase tracking-[0.18em]" style={{ color: riskColor(score) }}>
                  {BAND_LABEL[band]}
                </span>
                <span className="text-[0.88rem] text-muted">{BAND_BLURB[band]}</span>
              </div>
            ))}
          </div>
          <p className="pt-1">
            The combined number is computed in code (not by the model): a weighted average of the five dimensions,
            blended toward the single worst one — because one fatal clause can blow up a market even when everything
            else is clean. The five dimensions:
          </p>
          <div className="glass divide-y divide-line rounded-2xl">
            {DIMENSIONS.map((d, i) => (
              <div key={d.name} className="flex gap-3 px-4 py-3.5">
                <span className="mono shrink-0 text-sm text-faint">{i + 1}</span>
                <div>
                  <div className="text-[0.95rem] font-medium text-fg">{d.name}</div>
                  <div className="mt-0.5 text-[0.88rem] text-muted">{d.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section label="two ways in" title="Look one up, or scan the board">
          <p>
            <Link href="/" className="text-brand hover:underline">
              Lookup
            </Link>{' '}
            scores a single market on demand — paste a Kalshi ticker, a Polymarket slug or URL, or raw resolution text,
            and you get the gauge, the five bars, and the offending clauses. Use it as a pre-trade check before you
            commit capital.
          </p>
          <p>
            <Link href="/board" className="text-brand hover:underline">
              The Board
            </Link>{' '}
            is every high-volume market, scored once and <span className="text-fg">cached</span> — so it loads instantly
            and is free to browse. Filter by platform, category, or risk band; sort; and click any row for the full
            breakdown. New markets get scored once (a few cents) and then live in the cache forever, because a
            market&rsquo;s rules don&rsquo;t change.
          </p>
        </Section>

        <Section label="reading a row" title="What the chips mean">
          <p>Each board row packs the decision-relevant facts into one line:</p>
          <ul className="space-y-2">
            {[
              ['the big number', 'the 0–100 resolution-risk score, colored by band.'],
              ['Yes 88¢', 'the current market price — the crowd’s implied probability.'],
              ['×28', 'how many markets share this rulebook (a fan-out, e.g. every World Cup team).'],
              ['2d / 6mo', 'how soon it resolves.'],
              ['no source', 'no authoritative source of truth is named — the biggest red flag.'],
              ['act 61 · rules → No · 91¢', 'an edge: the rules and the price disagree (see below).'],
            ].map(([k, v]) => (
              <li key={k} className="flex flex-col gap-1 rounded-xl border border-line bg-black/20 px-3.5 py-2.5 sm:flex-row sm:gap-3">
                <span className="mono shrink-0 text-xs text-brand sm:w-40">{k}</span>
                <span className="text-[0.88rem] text-muted">{v}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section label="trade signals" title="Risk + price = where the edge lives">
          <p>
            A risk score alone isn&rsquo;t a trade — it says a market is <em>ambiguous</em>, not which way it resolves.
            The signal comes from combining it with the price:
          </p>
          <ul className="ml-1 list-disc space-y-1.5 pl-5">
            <li>
              <span className="text-fg">Directional lean</span> — which side the <em>literal</em> rules favor when they
              diverge from the intuitive reading (rules → Yes / No).
            </li>
            <li>
              <span className="text-brand">Edge</span> — flagged when the lean disagrees with the crowd&rsquo;s price
              (rules favor No, but it&rsquo;s priced 91¢ Yes).
            </li>
            <li>
              <span className="text-fg">Actionability</span> — ranks edges by how dislocated the price is × how soon it
              resolves × how real the trap is, so a near-term mispricing beats a 2099 lottery. Toggle{' '}
              <span className="mono text-brand">edges</span> and sort by edge to see them.
            </li>
          </ul>
          <div className="glass rounded-2xl border-l-2 border-l-brand/60 px-4 py-3.5">
            <div className="label">how to actually use it</div>
            <p className="mt-2 text-[0.92rem] text-muted">
              Treat edges as <span className="text-fg">flags, not buy buttons</span>. Litmus finds the trap and tells
              you it&rsquo;s mispriced — <span className="text-fg">you</span> supply the last input: can that
              technicality actually happen? The sweet spot is{' '}
              <span className="text-fg">high risk × a live, near-term event × a dislocated price</span>. High risk on a
              dead event (&ldquo;Jesus returns&rdquo;) is untradeable — and the engine will tell you so.
            </p>
          </div>
        </Section>

        <Section label="watchlist & alerts" title="It watches so you don't have to">
          <p>
            Star any market on the board to add it to your <span className="text-fg">watchlist</span>. A watched market
            resolving within two weeks (or whose rules quietly changed) surfaces in the alert banner. And a launchd job
            runs every morning to refresh prices and fire a <span className="text-fg">macOS notification</span> about
            watched markets and hot edges — zero cost, no key, fully unattended.
          </p>
          <p className="mono text-[0.82rem] text-faint">
            run now: launchctl kickstart -k gui/$(id -u)/com.litmus.daily &nbsp;·&nbsp; off: launchctl bootout …
          </p>
        </Section>

        <Section label="run it yourself" title="The commands">
          <div className="glass divide-y divide-line rounded-2xl">
            {COMMANDS.map((c) => (
              <div key={c.cmd} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <code className="mono shrink-0 text-[0.82rem] text-brand sm:w-[19rem]">{c.cmd}</code>
                <span className="text-[0.88rem] text-muted">{c.desc}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section label="why trust it" title="It's validated, not vibes">
          <p>
            Litmus was backtested against real, already-resolved markets that went to a documented dispute — scored
            blind, seeing only the original rules. It retroactively flagged{' '}
            <span className="text-fg">9 of 12 (75%, 95% CI 47–91%)</span> whose ambiguity was present in the text,
            and scored the control market — whose surprise came from outside the rules — deep in the low band. Every
            case is on the <span className="text-fg">Cases</span> page; method, intervals, and honest limits are in{' '}
            <span className="mono text-faint">docs/BACKTEST.md</span>. And the <span className="text-fg">Track</span>{' '}
            tab grades every live call against what actually settles — including a crowd-price baseline, so the tool
            has to beat the market, not just sound smart.
          </p>
        </Section>
      </div>

      <div className="mt-12 border-t border-line pt-6 text-center">
        <p className="mono text-xs text-faint">Litmus · resolution-risk scanner · powered by Claude Opus 4.8</p>
      </div>
    </div>
  )
}
