import { execFileSync } from 'node:child_process'
import { loadCatalog, loadScores } from './store'
import { loadPrices, pointBefore } from './prices'
import { watchlistView } from './watchlist'
import { edgeTag, actionability, STALE_HOURS } from '../../lib/litmus'

const ALERT_DAYS = Number(process.env.ALERT_DAYS || '14')
const HOT_DAYS = Number(process.env.HOT_DAYS || '10')

function notify(message: string): void {
  if (process.platform !== 'darwin') return
  const safe = message.replace(/["·]/g, '-')
  try {
    execFileSync('osascript', ['-e', `display notification "${safe}" with title "Litmus alerts"`])
  } catch {
    /* notifications are best-effort */
  }
}

function main(): void {
  const { closingSoon, changed } = watchlistView(ALERT_DAYS)
  const catalog = loadCatalog()
  const scores = loadScores()
  const prices = loadPrices()
  const now = Date.now()

  // Hot edges resolving soon (whether or not they're watched), plus edges that
  // FORMED since yesterday — the crowd just moved against the rules-implied side.
  // Edges built on stale prices are suppressed: a dislocation we can't confirm is
  // current isn't an alert, it's a guess.
  const hot: { q: string; d: number; act: number; label: string }[] = []
  const fresh: { q: string; label: string; d: number | null; act: number }[] = []
  let staleSkipped = 0
  for (const e of catalog) {
    const s = scores[e.rulebookHash]
    if (!s) continue
    const edge = edgeTag(s.literalFavors, e.priceYes, s.leanConfidence)
    if (!edge) continue
    const priceAge = e.priceAsOf ? (now - Date.parse(e.priceAsOf)) / 3_600_000 : Infinity
    if (priceAge > STALE_HOURS) {
      staleSkipped++
      continue
    }
    const d = e.closeDate ? Math.round((new Date(e.closeDate).getTime() - now) / 86_400_000) : null
    const act = actionability(s.combined, edge, e.closeDate)

    // Newly formed: yesterday's observation didn't qualify as an edge. The prior point
    // must actually be from ~yesterday (≤48h) — after a history gap we stay silent
    // rather than announce a weeks-old dislocation as new. (The comparison uses today's
    // lean, so a lean flip on an unchanged price also lands here — hence the label.)
    const prior = pointBefore(prices[e.rulebookHash], 20, now, 48)
    if (prior && !edgeTag(s.literalFavors, prior.p, s.leanConfidence) && (d == null || d >= 0)) {
      fresh.push({ q: e.question, label: edge.label, d, act })
    }

    if (d != null && d >= 0 && d <= HOT_DAYS) {
      hot.push({ q: e.question, d, act, label: edge.label })
    }
  }
  hot.sort((a, b) => b.act - a.act)
  fresh.sort((a, b) => b.act - a.act)
  const hotTop = hot.slice(0, 8)
  const freshTop = fresh.slice(0, 8)

  console.log('\n  LITMUS ALERTS\n')
  if (closingSoon.length) {
    console.log('  watched, resolving soon:')
    for (const a of closingSoon) {
      console.log(`     ${a.daysUntil === 0 ? 'today' : a.daysUntil + 'd'}  ${a.question}${a.combined != null ? `  (risk ${a.combined})` : ''}`)
    }
    console.log('')
  }
  if (changed.length) {
    console.log('  watched, rules changed / closed:')
    for (const a of changed) console.log(`     ${a.question}`)
    console.log('')
  }
  if (freshTop.length) {
    console.log('  new edges (formed since yesterday — price or lean moved):')
    for (const f of freshTop) {
      console.log(`     ${f.d != null ? (f.d === 0 ? 'today' : f.d + 'd') : '—'} · ${f.label}  ${f.q.slice(0, 46)}`)
    }
    console.log('')
  }
  if (hotTop.length) {
    console.log(`  hot edges closing within ${HOT_DAYS}d:`)
    for (const h of hotTop) {
      console.log(`     act ${String(h.act).padStart(2)} · ${h.d}d · ${h.label}  ${h.q.slice(0, 46)}`)
    }
    console.log('')
  }
  if (staleSkipped) {
    console.log(`  (${staleSkipped} edge${staleSkipped === 1 ? '' : 's'} suppressed — prices older than ${STALE_HOURS}h)\n`)
  }
  if (!closingSoon.length && !changed.length && !hotTop.length && !freshTop.length) {
    console.log('  Nothing urgent right now. ✓\n')
    return
  }

  const parts: string[] = []
  if (freshTop.length) parts.push(`${freshTop.length} new edges`)
  if (closingSoon.length) parts.push(`${closingSoon.length} watched closing`)
  if (changed.length) parts.push(`${changed.length} rules changed`)
  if (hotTop.length) parts.push(`${hotTop.length} hot edges`)
  notify(parts.join(' · '))
}

main()
