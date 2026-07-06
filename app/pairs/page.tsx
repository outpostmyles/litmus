import { PairsClient } from '@/components/PairsClient'

export const metadata = { title: 'Litmus — cross-venue pairs' }

export default function PairsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <section className="pb-7 pt-4">
        <div className="label">cross-venue</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Same event, different rules?</h1>
        <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
          When Kalshi and Polymarket list the <span className="text-fg">same real-world event</span>, a price gap
          between them looks like free money — but the arb only works if both venues settle identically. Litmus
          matches cross-venue pairs, diffs their resolution rules clause by clause, and names the{' '}
          <span className="text-fg">concrete scenario</span> under which one venue pays Yes and the other pays No.
        </p>
      </section>
      <PairsClient />
    </div>
  )
}
