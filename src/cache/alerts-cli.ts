import { execFileSync } from 'node:child_process'
import { loadCatalog, loadScores } from './store'
import { watchlistView } from './watchlist'
import { edgeTag, actionability } from '../../lib/litmus'

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

  // Hot edges resolving soon (whether or not they're watched).
  const hot: { q: string; d: number; act: number; label: string }[] = []
  for (const e of catalog) {
    const s = scores[e.rulebookHash]
    if (!s) continue
    const edge = edgeTag(s.literalFavors, e.priceYes)
    if (!edge) continue
    const d = e.closeDate ? Math.round((new Date(e.closeDate).getTime() - Date.now()) / 86_400_000) : null
    if (d != null && d >= 0 && d <= HOT_DAYS) {
      hot.push({ q: e.question, d, act: actionability(s.combined, edge, e.closeDate), label: edge.label })
    }
  }
  hot.sort((a, b) => b.act - a.act)
  const hotTop = hot.slice(0, 8)

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
  if (hotTop.length) {
    console.log(`  hot edges closing within ${HOT_DAYS}d:`)
    for (const h of hotTop) {
      console.log(`     act ${String(h.act).padStart(2)} · ${h.d}d · ${h.label}  ${h.q.slice(0, 46)}`)
    }
    console.log('')
  }
  if (!closingSoon.length && !changed.length && !hotTop.length) {
    console.log('  Nothing urgent right now. ✓\n')
    return
  }

  const parts: string[] = []
  if (closingSoon.length) parts.push(`${closingSoon.length} watched closing`)
  if (changed.length) parts.push(`${changed.length} rules changed`)
  if (hotTop.length) parts.push(`${hotTop.length} hot edges`)
  notify(parts.join(' · '))
}

main()
