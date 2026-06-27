import { BoardClient } from '@/components/BoardClient'

export default function BoardPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <section className="pb-7 pt-4">
        <div className="label">the board</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Riskiest live markets</h1>
        <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
          Pull a slice of live markets and score every one. They stream in and re-rank by resolution risk as the engine
          reads each rulebook.
        </p>
      </section>

      <BoardClient />
    </div>
  )
}
