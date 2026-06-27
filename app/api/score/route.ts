import { NextResponse } from 'next/server'
import { scoreMarket } from '@/src/engine/score'
import { fetchKalshiMarket } from '@/src/platforms/kalshi'
import { fetchPolymarketMarket } from '@/src/platforms/polymarket'
import type { MarketInput } from '@/src/engine/types'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const mode = String(body?.mode ?? 'text')
    const value = String(body?.value ?? '').trim()

    let market: MarketInput
    if (mode === 'kalshi') {
      if (!value) return NextResponse.json({ error: 'Enter a Kalshi ticker.' }, { status: 400 })
      market = await fetchKalshiMarket(value)
    } else if (mode === 'polymarket') {
      if (!value) return NextResponse.json({ error: 'Enter a Polymarket slug or URL.' }, { status: 400 })
      market = await fetchPolymarketMarket(value)
    } else {
      if (!value) return NextResponse.json({ error: 'Paste the resolution criteria text.' }, { status: 400 })
      market = {
        platform: typeof body?.platform === 'string' && body.platform ? body.platform : 'Custom',
        question: typeof body?.question === 'string' && body.question ? body.question : 'Pasted market',
        resolutionText: value,
        outcomes: ['Yes', 'No'],
      }
    }

    const score = await scoreMarket(market)
    return NextResponse.json({
      ...score,
      market: {
        platform: market.platform,
        question: market.question,
        marketId: market.marketId,
        resolutionText: market.resolutionText,
        resolutionSource: market.resolutionSource ?? null,
        closeDate: market.closeDate ?? null,
        outcomes: market.outcomes ?? ['Yes', 'No'],
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scoring failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
