import { LookupForm } from '@/components/LookupForm'

export const metadata = { title: 'Litmus — score a market' }

export default function LookupPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="pb-7 pt-4">
        <div className="label">score a market</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Will it settle the way you think?</h1>
        <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
          Paste a Kalshi ticker, a Polymarket slug or URL, or the raw resolution text. Litmus scores the five ways
          settlement goes sideways and quotes the exact clause behind each one.
        </p>
      </section>
      <LookupForm />
    </div>
  )
}
