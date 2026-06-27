'use client'

import { useEffect, useState } from 'react'
import { motion, animate } from 'framer-motion'
import { bandFromScore, BAND_LABEL, riskColor } from '@/lib/litmus'

export function RiskGauge({ score, size = 224 }: { score: number; size?: number }) {
  const color = riskColor(score)
  const band = bandFromScore(score)
  const stroke = 13
  const r = (size - stroke - 10) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  const SWEEP = 0.74
  const arcLen = circ * SWEEP
  const rot = 90 + (1 - SWEEP) * 180 // gap centered at the bottom

  const [n, setN] = useState(0)
  useEffect(() => {
    const controls = animate(0, score, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setN(Math.round(v)),
    })
    return () => controls.stop()
  }, [score])

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: `rotate(${rot}deg)` }}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(150,162,215,0.10)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circ}`}
        />
        <motion.circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circ}`}
          initial={{ strokeDashoffset: arcLen }}
          animate={{ strokeDashoffset: arcLen * (1 - Math.max(0, Math.min(100, score)) / 100) }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 9px ${riskColor(score, 0.55)})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="mono text-[3.4rem] font-semibold leading-none" style={{ color }}>
          {n}
        </div>
        <div className="label mt-2">resolution risk</div>
        <div className="mono mt-2 text-sm font-medium tracking-[0.22em]" style={{ color }}>
          {BAND_LABEL[band]}
        </div>
      </div>
    </div>
  )
}
