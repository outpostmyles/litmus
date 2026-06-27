import { scoreMarket } from '@/src/engine/score'
import { listKalshiMarkets } from '@/src/platforms/kalshi'
import { listPolymarketMarkets } from '@/src/platforms/polymarket'
import type { MarketInput } from '@/src/engine/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const CONCURRENCY = 4

export async function POST(req: Request) {
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
      let next = 0
      async function worker() {
        while (next < markets.length) {
          const i = next++
          const m = markets[i]
          if (!m) continue
          try {
            const s = await scoreMarket(m)
            send(controller, {
              type: 'result',
              id: m.marketId ?? `${platform}-${i}`,
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
