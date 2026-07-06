import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import { Nav } from '@/components/Nav'
import { IntroStrip } from '@/components/IntroStrip'

const display = Space_Grotesk({ subsets: ['latin'], variable: '--ff-display', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--ff-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Litmus — resolution-risk scanner',
  description:
    'Scores how likely a Kalshi or Polymarket market is to settle differently than traders expect — by reading its resolution criteria.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <Nav />
        <IntroStrip />
        <main className="relative mx-auto w-full max-w-6xl px-5 pb-28 pt-10 sm:px-8">{children}</main>
      </body>
    </html>
  )
}
