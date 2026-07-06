'use client'

// The 3-second layer, rendered IDENTICALLY everywhere it appears — market page,
// board row, bot replies, digest items, receipt cards. One format, learned once:
//   [LEAN chip] · trap: [trap phrase]

export interface VerdictData {
  lean: 'YES' | 'NO' | 'UNCLEAR'
  lean_confidence: number
  trap_phrase: string
  killer_clause: string | null
  so_what: string
}

const LEAN_STYLE: Record<VerdictData['lean'], string> = {
  YES: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  NO: 'bg-rose-400/15 text-rose-300 border-rose-400/30',
  UNCLEAR: 'bg-white/[0.06] text-muted border-line',
}

export function LeanChip({ v, size = 'md' }: { v: VerdictData; size?: 'sm' | 'md' }) {
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[0.62rem]' : 'px-2 py-0.5 text-[0.72rem]'
  return (
    <span className={`mono rounded-md border font-semibold tracking-wider ${pad} ${LEAN_STYLE[v.lean]}`}>
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
