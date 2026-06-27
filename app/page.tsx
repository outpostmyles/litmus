import { LookupForm } from '@/components/LookupForm'

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="pb-9 pt-6 text-center sm:pt-12">
        <div className="label mx-auto inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand" />
          83% recall on real resolution disputes
        </div>
        <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-[3.3rem]">
          Will it settle the way{' '}
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">you think?</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-[1.02rem] leading-relaxed text-muted">
          Litmus reads a market’s resolution criteria and scores how likely it is to settle differently than traders
          expect — before you commit capital.
        </p>
      </section>

      <LookupForm />
    </div>
  )
}
