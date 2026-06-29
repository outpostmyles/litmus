import { TrackClient } from '@/components/TrackClient'

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <section className="pb-7 pt-4">
        <div className="label">the track record</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Were we right?</h1>
        <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
          Every call Litmus makes is logged and graded when the market resolves. The <span className="text-fg">edges</span>{' '}
          are scored as paper trades — a live win/loss record and simulated P&amp;L. The <span className="text-fg">risk
          scores</span> are graded on calibration: do high-risk markets actually settle differently than the crowd
          expects?
        </p>
      </section>

      <TrackClient />
    </div>
  )
}
