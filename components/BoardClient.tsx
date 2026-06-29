'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { riskColor, BAND_LABEL, type RiskBand } from '@/lib/litmus'

interface Item {
  id: string
  platform: string
  question: string
  combined: number
  band: RiskBand
  headlineRisk: string
  namedSource: string | null
}

const KALSHI_CATS = [
  'Politics',
  'Economics',
  'Financials',
  'Companies',
  'World',
  'Science and Technology',
  'Climate and Weather',
  'Entertainment',
]

export function BoardClient() {
  const [platform, setPlatform] = useState<'kalshi' | 'polymarket'>('kalshi')
  const [category, setCategory] = useState('Politics')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(8)
  const [running, setRunning] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function scan() {
    setRunning(true)
    setItems([])
    setTotal(0)
    setError(null)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, category, query, limit }),
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.error || 'Scan failed.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const ev = JSON.parse(line)
          if (ev.type === 'meta') setTotal(ev.total)
          else if (ev.type === 'result') {
            const s = ev.score
            const item: Item = {
              id: ev.id,
              platform: ev.market.platform,
              question: ev.market.question,
              combined: s.combined,
              band: s.band,
              headlineRisk: s.headlineRisk,
              namedSource: s.namedSource,
            }
            setItems((prev) => [...prev, item].sort((a, b) => b.combined - a.combined))
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <div className="glass rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl bg-black/30 p-1">
            {(['kalshi', 'polymarket'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-lg px-3.5 py-1.5 text-sm capitalize transition-colors ${
                  platform === p ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {platform === 'kalshi' ? (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-xl border border-line bg-black/30 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-brand/40"
            >
              {KALSHI_CATS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter (optional) — e.g. election"
              className="mono rounded-xl border border-line bg-black/30 px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:ring-1 focus:ring-brand/40"
            />
          )}

          <label className="mono flex items-center gap-2 text-xs text-faint">
            count
            <input
              type="range"
              min={3}
              max={16}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="accent-[color:var(--color-brand)]"
            />
            <span className="w-5 text-fg">{limit}</span>
          </label>

          <button
            onClick={scan}
            disabled={running}
            className="ml-auto rounded-xl bg-gradient-to-r from-brand to-brand-2 px-5 py-2 text-sm font-semibold text-void transition hover:brightness-110 disabled:opacity-40"
          >
            {running ? 'Scanning…' : 'Scan'}
          </button>
        </div>

        {(running || total > 0) && (
          <div className="mt-3 flex items-center gap-3 px-1">
            <div className="track h-1 flex-1">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
                animate={{ width: total ? `${(items.length / total) * 100}%` : '8%' }}
                transition={{ ease: 'easeOut' }}
              />
            </div>
            <span className="mono shrink-0 text-xs text-faint">
              {items.length}/{total || '…'} scored
            </span>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        <AnimatePresence>
          {items.map((it, rank) => {
            const color = riskColor(it.combined)
            return (
              <motion.div
                key={it.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ layout: { duration: 0.5, ease: [0.16, 1, 0.3, 1] }, duration: 0.4 }}
                className="glass relative flex items-center gap-4 overflow-hidden rounded-2xl px-4 py-3.5 sm:px-5"
              >
                <div className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
                <div className="mono w-6 shrink-0 text-center text-sm text-faint">{rank + 1}</div>
                <div className="flex w-16 shrink-0 flex-col items-center">
                  <span className="mono text-2xl font-semibold leading-none tabular-nums" style={{ color }}>
                    {it.combined}
                  </span>
                  <span className="mono mt-1 text-[0.58rem] tracking-[0.12em]" style={{ color }}>
                    {BAND_LABEL[it.band]}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[0.62rem] uppercase tracking-wider text-faint">{it.platform}</span>
                    {!it.namedSource && (
                      <span className="mono text-[0.62rem] uppercase tracking-wider text-rose-400/80">no source</span>
                    )}
                  </div>
                  <div className="truncate text-[0.95rem] font-medium text-fg">{it.question}</div>
                  <div className="mt-0.5 line-clamp-1 text-[0.82rem] text-muted">{it.headlineRisk}</div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {!running && items.length === 0 && !error && (
          <div className="glass rounded-2xl px-6 py-16 text-center">
            <p className="text-sm text-muted">Pick a platform and category, then hit Scan.</p>
            <p className="label mt-2">live markets, ranked by resolution risk</p>
          </div>
        )}
      </div>
    </div>
  )
}
