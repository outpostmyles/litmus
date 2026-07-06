'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// First-visit strip: one plain-language line for someone who just landed. Dismissal
// persists via a cookie (not localStorage — survives storage-clearing privacy modes
// and works the same once accounts exist server-side).
const COOKIE = 'litmus_intro_dismissed'

export function IntroStrip() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE}=`))) setShow(true)
  }, [])
  if (!show) return null
  return (
    <div className="border-b border-line bg-brand/[0.06]">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-2 text-[0.84rem] sm:px-8">
        <p className="min-w-0 flex-1 text-fg/90">
          Litmus reads each market&rsquo;s settlement rules and tells you which side the fine print favors. Scores
          0–100 = how likely this market settles differently than traders expect.{' '}
          <Link href="/guide" className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand">
            How it works
          </Link>
        </p>
        <button
          onClick={() => {
            document.cookie = `${COOKIE}=1; max-age=31536000; path=/`
            setShow(false)
          }}
          aria-label="dismiss"
          className="mono shrink-0 rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:text-fg"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
