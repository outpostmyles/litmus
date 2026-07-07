import { scoreMarket } from '@/src/engine/score'
import { budgetAllows } from '@/src/lib/spend'
import { rulebookHash, loadScores } from '@/src/cache/store'
import { listKalshiMarkets } from '@/src/platforms/kalshi'
import { listPolymarketMarkets } from '@/src/platforms/polymarket'
import type { MarketInput } from '@/src/engine/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const CONCURRENCY = 4

export async function POST(req: Request) {
  // Same daily-budget hard stop as /api/score — this endpoint scores up to 16
  // markets per call and must never be an unbounded public spend hole.
  if (!budgetAllows().ok) {
    return Response.json(
      { error: 'Daily scoring budget reached — try again tomorrow or raise LITMUS_DAILY_BUDGET_USD.' },
      { status: 429 },
    )
  }
  const body = await req.json().catch(() => ({}))
  const platform = body?.platform === 'kalshi' ? 'kalshi' : 'polymarket'
  const limit = Math.max(3, Math.min(16, Number(body?.limit) || 8))

  let markets: MarketInput[]
  try {
    markets =
      platform === 'kalshi'
        ? await listKalshiMarkets({ category: body?.category, limit })
        : await listPolymarketMarkets({ limit, query: body?.query, event: body?.event })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to list markets.' }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController, obj: unknown) =>
    controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))

  const stream = new ReadableStream({
    async start(controller) {
      send(controller, { type: 'meta', total: markets.length, platform })
      const cache = loadScores()
      let next = 0
      async function worker() {
        while (next < markets.length) {
          const i = next++
          const m = markets[i]
          if (!m) continue
          try {
            // Cache-first (never pay twice): serve a matching rulebook hash for free.
            const cached = m.resolutionText ? cache[rulebookHash(m.platform, m.resolutionText)] : undefined
            const s =
              cached ??
              (budgetAllows().ok
                ? await scoreMarket(m)
                : (() => {
                    throw new Error('Daily scoring budget reached — this market was skipped.')
                  })())
            send(controller, {
              type: 'result',
              id: m.marketId ?? `${platform}-${i}`,
              cached: !!cached,
              market: { platform: m.platform, question: m.question, marketId: m.marketId },
              score: {
                combined: s.combined,
                band: s.band,
                headlineRisk: s.headlineRisk,
                namedSource: s.namedSource,
                dimensions: s.dimensions.map((d) => ({ key: d.key, label: d.label, score: d.score })),
              },
            })
          } catch (err) {
            send(controller, {
              type: 'item-error',
              id: m.marketId ?? `${platform}-${i}`,
              question: m.question,
              message: err instanceof Error ? err.message : 'scoring failed',
            })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, markets.length) }, () => worker()))
      send(controller, { type: 'done' })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache, no-transform' },
  })
}
