import { Dashboard } from '@/components/Dashboard'

export default function BoardPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <section className="pb-7 pt-4">
        <div className="label">the board</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Riskiest live markets</h1>
        <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
          Every high-volume market on Kalshi and Polymarket, scored once and cached — ranked by resolution risk. Filter,
          sort, and click any row for the full breakdown.
        </p>
      </section>

      <Dashboard />
    </div>
  )
}
