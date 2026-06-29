import { setWatch, watchlistView } from '@/src/cache/watchlist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  const view = watchlistView()
  return Response.json({
    hashes: view.entries.map((e) => e.hash),
    closingSoon: view.closingSoon,
    changed: view.changed,
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const hash = typeof body?.hash === 'string' ? body.hash : ''
  if (!hash) return Response.json({ error: 'hash required' }, { status: 400 })

  const action = body?.action === 'add' ? 'add' : body?.action === 'remove' ? 'remove' : 'toggle'
  const current = watchlistView().entries.some((e) => e.hash === hash)
  const on = action === 'add' ? true : action === 'remove' ? false : !current

  setWatch(hash, on, { question: body?.question, platform: body?.platform })
  return Response.json({ hash, watched: on })
}
