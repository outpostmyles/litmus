'use client'

import { useState } from 'react'
import type { ScoreResult } from '@/lib/litmus'
import { ResultCard } from './ResultCard'
import { Scanning } from './Scanning'

type Mode = 'kalshi' | 'polymarket' | 'text'

const MODES: { id: Mode; label: string; placeholder: string }[] = [
  { id: 'kalshi', label: 'Kalshi', placeholder: 'Ticker — e.g. KXELONMARS-99' },
  { id: 'polymarket', label: 'Polymarket', placeholder: 'Slug or URL — e.g. will-the-us-invade-iran-before-2027' },
  { id: 'text', label: 'Paste text', placeholder: 'Paste the full resolution criteria…' },
]

const EXAMPLES: { mode: Mode; value: string; label: string }[] = [
  { mode: 'kalshi', value: 'KXELONMARS-99', label: 'Elon → Mars' },
  { mode: 'polymarket', value: 'will-the-us-invade-iran-before-2027', label: 'US invades Iran · scores 74' },
]

export function LookupForm() {
  const [mode, setMode] = useState<Mode>('kalshi')
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScoreResult | null>(null)

  async function run(m: Mode, v: string) {
    setMode(m)
    setValue(v)
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: m, value: v }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Scoring failed.')
      setResult(data as ScoreResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scoring failed.')
    } finally {
      setLoading(false)
    }
  }

  const current = MODES.find((x) => x.id === mode) ?? MODES[0]!

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim() && !loading) run(mode, value.trim())
        }}
        className="glass rounded-2xl p-2.5"
      >
        <div className="flex gap-1 p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm transition-colors ${
                mode === m.id ? 'bg-white/[0.07] text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 p-1 sm:flex-row">
          {mode === 'text' ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={current.placeholder}
              rows={4}
              className="mono w-full resize-none rounded-xl bg-black/30 px-4 py-3 text-sm text-fg outline-none placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand/50"
            />
          ) : (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={current.placeholder}
              className="mono w-full rounded-xl bg-black/30 px-4 py-3 text-sm text-fg outline-none placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand/50"
            />
          )}
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-brand to-brand-2 px-6 py-3 text-sm font-semibold text-void transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="label">try</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.value}
            onClick={() => run(ex.mode, ex.value)}
            disabled={loading}
            className="mono rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-brand/40 hover:text-fg disabled:opacity-40"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      <div className="mt-7">
        {loading && <Scanning />}
        {!loading && result && (
          <ResultCard key={result.market.marketId || result.market.question} r={result} />
        )}
      </div>
    </div>
  )
}
