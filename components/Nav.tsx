'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Primary nav is the first-visit path: the answer, the universe, the proof.
// /worldcup is intentionally absent — it was built for a specific tournament that
// has ended, and a stale tab in the nav reads as an abandoned project. The page
// still exists and is linked from the Cases page as an archived event study.
const LINKS = [
  { href: '/board', label: 'Board' },
  { href: '/pairs', label: 'Pairs' },
  { href: '/track', label: 'Track' },
  { href: '/cases', label: 'Cases' },
  { href: '/lookup', label: 'Lookup' },
  { href: '/guide', label: 'Guide' },
]

/**
 * A litmus test strip: four bands in the product's own risk ramp (the same hue sweep
 * riskColor() applies to every score — low/green through severe/red). The mark is the
 * thing the tool does: a strip whose colour tells you the result at a glance.
 */
export function LitmusMark({ size = 30 }: { size?: number }) {
  const bands = ['hsl(130 88% 62%)', 'hsl(70 88% 62%)', 'hsl(30 88% 62%)', 'hsl(3 88% 62%)']
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <g>
        {bands.map((c, i) => (
          <rect key={c} x="13" y={5 + i * 7.6} width="14" height="6.4" rx="1.4" fill={c} opacity={0.55 + i * 0.15} />
        ))}
      </g>
      <rect x="11.2" y="3.2" width="17.6" height="33.6" rx="3.2" stroke="var(--color-line)" strokeWidth="1.4" />
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

        {/* Scrolls rather than overflowing on narrow viewports — the header used to
            blow out to 663px inside a 390px phone screen. */}
        <nav className="-mx-2 flex items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand/50 ${
                  active ? 'bg-white/[0.06] text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
