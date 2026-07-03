'use client'

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { riskColor, edgeTag, actionability, type ScoreResult } from '@/lib/litmus'
import { RiskGauge } from './RiskGauge'
import { DimensionRow } from './DimensionRow'

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="mono rounded-md border border-line bg-white/[0.03] px-2 py-0.5 text-[0.7rem] tracking-wider text-muted">
      {children}
    </span>
  )
}

function Meta({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-black/20 px-3.5 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1.5 text-[0.86rem] leading-snug ${warn ? 'text-rose-300' : 'text-fg'}`}>{value}</div>
    </div>
  )
}

export function ResultCard({ r }: { r: ScoreResult }) {
  const color = riskColor(r.combined)
  const closes = fmtDate(r.market.closeDate)
  const edge = edgeTag(r.literalFavors, r.market.priceYes, r.leanConfidence)
  const act = edge ? actionability(r.combined, edge, r.market.closeDate) : 0
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="glass relative overflow-hidden rounded-3xl"
    >
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      <div
        className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full opacity-30 blur-3xl"
        style={{ background: riskColor(r.combined, 0.5) }}
      />

      <div className="relative p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{r.market.platform}</Chip>
          {r.market.marketId && <span className="mono text-xs text-faint">{r.market.marketId}</span>}
          {closes && <span className="mono text-xs text-faint">· closes {closes}</span>}
          {r.market.url && (
            <a
              href={r.market.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-xs text-faint underline decoration-line underline-offset-4 transition-colors hover:text-brand"
            >
              open market ↗
            </a>
          )}
        </div>
        <h2 className="mt-3 text-2xl font-semibold leading-snug text-fg sm:text-[1.7rem]">{r.market.question}</h2>

        {(r.market.priceYes != null || (r.literalFavors && r.literalFavors !== 'neither')) && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {r.market.priceYes != null && (
              <span className="mono rounded-md border border-line bg-white/[0.03] px-2.5 py-1 text-xs text-fg">
                market · Yes {Math.round(r.market.priceYes * 100)}¢
              </span>
            )}
            {r.literalFavors && r.literalFavors !== 'neither' && (
              <span className="mono rounded-md border border-line bg-white/[0.03] px-2.5 py-1 text-xs text-muted">
                rules lean → {r.literalFavors === 'yes' ? 'Yes' : 'No'}
                {r.leanConfidence != null && ` · ${Math.round(r.leanConfidence * 100)}%`}
              </span>
            )}
            {edge && (
              <span className="mono rounded-md border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
                edge {act} · {edge.label}
              </span>
            )}
          </div>
        )}
        {r.literalFavorsNote && r.literalFavors && r.literalFavors !== 'neither' && (
          <p className="mt-2 max-w-3xl text-[0.86rem] leading-relaxed text-muted">{r.literalFavorsNote}</p>
        )}

        <div className="mt-7 grid items-center gap-8 sm:grid-cols-[auto_1fr]">
          <div className="mx-auto">
            <RiskGauge score={r.combined} />
          </div>
          <div>
            <div className="label">headline risk</div>
            <p className="mt-2 text-[1.08rem] leading-relaxed text-fg">{r.headlineRisk}</p>
            <p className="mt-4 text-[0.97rem] leading-relaxed text-muted">{r.summary}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Meta label="source of truth" value={r.namedSource ?? '— none named —'} warn={!r.namedSource} />
              {r.assumedVsActual && <Meta label="assumed vs actual" value={r.assumedVsActual} />}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-line px-6 sm:px-8">
        <div className="label py-4">five dimensions</div>
        <div className="divide-y divide-line pb-2">
          {r.dimensions.map((d, i) => (
            <DimensionRow key={d.key} d={d} index={i} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 sm:px-8">
        <details className="group min-w-0">
          <summary className="mono cursor-pointer list-none text-xs text-faint transition-colors hover:text-muted">
view scored resolution text
          </summary>
          <p className="mono mt-3 max-w-3xl whitespace-pre-wrap text-[0.78rem] leading-relaxed text-muted">
            {r.market.resolutionText}
          </p>
        </details>
        <span className="mono shrink-0 text-[0.7rem] text-faint">
          {r.model}
          {r.usage ? ` · ${r.usage.inputTokens}→${r.usage.outputTokens} tok` : ''}
        </span>
      </div>
    </motion.section>
  )
}
