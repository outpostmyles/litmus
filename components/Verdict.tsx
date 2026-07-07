'use client'

import { useState } from 'react'

// The 3-second layer, rendered IDENTICALLY everywhere it appears — market page,
// board row, bot replies, digest items, receipt cards. One format, learned once:
//   [LEAN chip] · trap: [trap phrase]

export interface SideStance {
  stance: 'HELPS' | 'HURTS' | 'NEUTRAL' | 'UNCLEAR'
  line: string
}

export interface VerdictData {
  lean: 'YES' | 'NO' | 'UNCLEAR'
  lean_confidence: number
  trap_phrase: string
  killer_clause: string | null
  so_what: string
  yes_holder?: SideStance | null
  no_holder?: SideStance | null
  holder_note?: string | null
}

const LEAN_STYLE: Record<VerdictData['lean'], string> = {
  YES: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  NO: 'bg-rose-400/15 text-rose-300 border-rose-400/30',
  UNCLEAR: 'bg-white/[0.06] text-muted border-line',
}

export function LeanChip({ v, size = 'md' }: { v: VerdictData; size?: 'sm' | 'md' }) {
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[0.62rem]' : 'px-2 py-0.5 text-[0.72rem]'
  return (
    <span
      className={`mono rounded-md border font-semibold tracking-wider ${pad} ${LEAN_STYLE[v.lean]}`}
      title="Which side the written rules favor when they differ from what most traders assume."
    >
      {v.lean === 'UNCLEAR' ? 'UNCLEAR' : `RULES → ${v.lean}`}
    </span>
  )
}

/** L1: the one-line verdict. `compact` for board rows / list contexts. */
export function VerdictLine({ v, compact = false }: { v: VerdictData; compact?: boolean }) {
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-2 ${compact ? '' : 'text-[1.05rem]'}`}>
      <LeanChip v={v} size={compact ? 'sm' : 'md'} />
      <span className={`truncate ${compact ? 'text-[0.82rem] text-muted' : 'font-medium text-fg'}`}>
        <span className="mono mr-1 text-[0.7em] uppercase tracking-wider text-faint">trap:</span>
        {v.trap_phrase}
      </span>
    </span>
  )
}

const STANCE_STYLE: Record<SideStance['stance'], { chip: string; glyph: string; label: string }> = {
  HELPS: { chip: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30', glyph: '✓', label: 'the fine print helps this side' },
  HURTS: { chip: 'bg-rose-400/15 text-rose-300 border-rose-400/30', glyph: '⚠', label: 'the fine print hurts this side' },
  NEUTRAL: { chip: 'bg-white/[0.06] text-muted border-line', glyph: '·', label: 'the fine print cuts neither way' },
  UNCLEAR: { chip: 'bg-white/[0.06] text-faint border-line', glyph: '?', label: 'the text does not support a direction' },
}

/**
 * Compact per-side glyphs for board rows: "YES ✓ / NO ⚠" — the trade answer without
 * a click. Glyphs + tooltips only, no text, per the board-density rule.
 */
export function SideGlyphs({ v }: { v: VerdictData }) {
  if (!v.yes_holder && !v.no_holder) return null
  const g = (side: 'YES' | 'NO', s: SideStance | null | undefined) =>
    s ? (
      <span
        title={`${side} holder: ${STANCE_STYLE[s.stance].label} — ${s.line}`}
        className={`mono ${STANCE_STYLE[s.stance].chip.split(' ')[1]}`}
      >
        {side} {STANCE_STYLE[s.stance].glyph}
      </span>
    ) : null
  return (
    <span className="mono inline-flex shrink-0 items-baseline gap-1.5 text-[0.66rem]">
      {g('YES', v.yes_holder)}
      {v.yes_holder && v.no_holder && <span className="text-faint">/</span>}
      {g('NO', v.no_holder)}
    </span>
  )
}

/**
 * The "Your trade" module: which side do you hold? Defaults to both sides stacked so
 * the asymmetry is visible at a glance; the toggle focuses one side at its price.
 */
export function YourTrade({ v, priceYes }: { v: VerdictData; priceYes?: number | null }) {
  const [side, setSide] = useState<'YES' | 'NO' | null>(null)
  if (!v.yes_holder && !v.no_holder) return null
  const price = (s: 'YES' | 'NO') =>
    priceYes == null ? '' : ` @ ${Math.round((s === 'YES' ? priceYes : 1 - priceYes) * 100)}¢`

  const SideRow = ({ label, s }: { label: 'YES' | 'NO'; s: SideStance | null | undefined }) => {
    if (!s) return null
    const st = STANCE_STYLE[s.stance]
    return (
      <div className={`rounded-lg border px-3 py-2 ${s.stance === 'HURTS' ? 'border-rose-400/30 bg-rose-400/[0.05]' : 'border-line bg-black/20'}`}>
        <div className="flex items-baseline gap-2">
          <span className={`mono rounded border px-1.5 py-0.5 text-[0.62rem] font-semibold ${st.chip}`}>
            {label} {st.glyph} {s.stance}
          </span>
        </div>
        <p className="mt-1.5 text-[0.88rem] leading-relaxed text-fg/90">{s.line}</p>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="mono mb-2 flex items-center gap-2 text-[0.66rem] uppercase tracking-wider text-faint">
        <span title="Risk is directional: the same trap that endangers one side often helps the other.">your trade</span>
        <span className="flex gap-1">
          {(['YES', 'NO'] as const)
            .filter((sd) => (sd === 'YES' ? v.yes_holder : v.no_holder))
            .map((sd) => (
            <button
              key={sd}
              onClick={() => setSide(side === sd ? null : sd)}
              className={`rounded-md border px-2 py-0.5 transition-colors ${
                side === sd ? 'border-brand/50 bg-brand/10 text-brand' : 'border-line text-muted hover:text-fg'
              }`}
            >
              {sd}
              {price(sd)}
            </button>
          ))}
        </span>
      </div>
      <div className="space-y-2">
        {(side === null || side === 'YES') && <SideRow label="YES" s={v.yes_holder} />}
        {(side === null || side === 'NO') && <SideRow label="NO" s={v.no_holder} />}
      </div>
      {v.holder_note && (
        <p className="mono mt-2 text-[0.72rem] text-amber-300/80" title="For existing position holders.">
          holder note: {v.holder_note}
        </p>
      )}
    </div>
  )
}

/** L2: the receipt — killer clause quoted + the so-what sentence. */
export function KillerClause({ v }: { v: VerdictData }) {
  if (!v.killer_clause && !v.so_what) return null
  return (
    <div className="rounded-xl border border-line bg-black/20 px-4 py-3.5">
      {v.killer_clause && (
        <p className="mono border-l-2 border-amber-400/50 pl-3 text-[0.84rem] leading-relaxed text-fg/90">
          “{v.killer_clause}”
        </p>
      )}
      {v.so_what && <p className={`text-[0.92rem] leading-relaxed text-muted ${v.killer_clause ? 'mt-2.5' : ''}`}>{v.so_what}</p>}
    </div>
  )
}
