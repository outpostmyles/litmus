'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Lookup' },
  { href: '/board', label: 'Board' },
  { href: '/pairs', label: 'Pairs' },
  { href: '/track', label: 'Track' },
  { href: '/cases', label: 'Cases' },
  { href: '/guide', label: 'Guide' },
]

export function LitmusMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id="lm-g" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="0.55" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#fb7185" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="37" height="37" rx="11" stroke="url(#lm-g)" strokeWidth="1.6" opacity="0.7" />
      {/* indicator drop */}
      <path
        d="M20 9c4.6 5 7 8.4 7 12a7 7 0 1 1-14 0c0-3.6 2.4-7 7-12z"
        stroke="url(#lm-g)"
        strokeWidth="1.8"
        fill="url(#lm-g)"
        fillOpacity="0.16"
      />
      <circle cx="20" cy="22" r="2.4" fill="url(#lm-g)" />
    </svg>
  )
}

export function Nav() {
  const path = usePathname()
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[#0b0e14]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <span className="transition-transform duration-500 group-hover:rotate-[8deg]">
            <LitmusMark />
          </span>
          <span className="leading-none">
            <span className="block text-[1.05rem] font-semibold tracking-[0.34em] text-fg">LITMUS</span>
            <span className="label mt-1 hidden sm:block">resolution-risk scanner</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1.5">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand/50 ${
                  active ? 'bg-white/[0.06] text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
          <span className="mono ml-2 hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.7rem] text-faint sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand" />
            opus-4-8
          </span>
        </nav>
      </div>
    </header>
  )
}
