'use client'

import { motion } from 'framer-motion'

export function Scanning() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="glass relative overflow-hidden rounded-3xl"
    >
      <div className="scanline" />
      <div className="flex flex-col items-center gap-5 px-8 py-14 text-center">
        <div className="relative h-20 w-20">
          <div className="absolute inset-0 rounded-full border border-line" />
          <div className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-r-brand-2 border-t-brand" />
          <div className="absolute inset-3 animate-pulse-soft rounded-full bg-brand/10" />
        </div>
        <div>
          <div className="text-sm text-fg">Reading the resolution criteria</div>
          <div className="label mt-2">scoring five dimensions · opus-4-8</div>
        </div>
        <div className="mt-1 w-full max-w-md space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="track h-2 w-full">
              <div className="shimmer h-full w-full" style={{ animationDelay: `${i * 0.18}s` }} />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
