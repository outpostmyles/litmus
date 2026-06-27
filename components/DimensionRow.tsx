'use client'

import { motion } from 'framer-motion'
import { riskColor, type DimensionResult } from '@/lib/litmus'

export function DimensionRow({ d, index = 0 }: { d: DimensionResult; index?: number }) {
  const color = riskColor(d.score)
  return (
    <div className="py-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[0.95rem] font-medium text-fg">{d.label}</span>
        <span className="mono text-sm tabular-nums" style={{ color }}>
          {d.score}
        </span>
      </div>
      <div className="track mt-2 h-1.5 w-full">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color, boxShadow: `0 0 12px ${riskColor(d.score, 0.5)}` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(2, d.score)}%` }}
          transition={{ duration: 0.9, delay: 0.12 + index * 0.07, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <p className="mt-2.5 text-[0.92rem] leading-relaxed text-muted">{d.reasoning}</p>
      {d.offendingClause && (
        <p
          className="mono mt-2.5 border-l-2 pl-3 text-[0.8rem] leading-relaxed text-faint"
          style={{ borderColor: riskColor(d.score, 0.5) }}
        >
          “{d.offendingClause}”
        </p>
      )}
    </div>
  )
}
