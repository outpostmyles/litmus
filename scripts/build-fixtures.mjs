// One-time assembly of backtest fixtures from the research + fetch workflow outputs.
// Reads the (ephemeral) workflow result JSONs from the session scratchpad and
// writes one sanitized fixture per usable gold-set case into data/fixtures/backtest/.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'

const SC = process.argv[2]
if (!SC) {
  console.error('Usage: node scripts/build-fixtures.mjs <scratchpad-dir-with fetch-result.json + research-result.json>')
  process.exit(1)
}

const fetchData = JSON.parse(readFileSync(`${SC}/fetch-result.json`, 'utf8'))
const research = JSON.parse(readFileSync(`${SC}/research-result.json`, 'utf8'))
const gold = research.disputeGoldSet || []

function decode(s) {
  if (!s) return s
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
}

function sanitize(s) {
  if (!s) return ''
  let t = decode(s)
  // Strip any structured-output artifacts that leaked into the text.
  for (const marker of ['</resolutionText>', '<parameter name=', '</parameter>', '<resolutionText>']) {
    const i = t.indexOf(marker)
    if (i >= 0) t = t.slice(0, i)
  }
  return t.trim()
}

function classify(s) {
  // The verdict opens with its detectability call (e.g. "STRONG backtest case...",
  // "PARTIALLY detectable", "MIXED — ...", "WEAK..."). Use whichever keyword appears
  // FIRST, not includes() — the reasoning later mentions other levels in passing.
  const u = (s || '').toUpperCase()
  let best = 'STRONG'
  let bestAt = Infinity
  for (const kw of ['STRONG', 'PARTIAL', 'MIXED', 'WEAK']) {
    const at = u.indexOf(kw)
    if (at >= 0 && at < bestAt) {
      bestAt = at
      best = kw
    }
  }
  return best
}

function question(title) {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function parseOutcomes(o) {
  if (Array.isArray(o) && o.length) return o
  if (typeof o === 'string') {
    try {
      const p = JSON.parse(o)
      if (Array.isArray(p)) return p
    } catch {
      /* ignore */
    }
  }
  return ['Yes', 'No']
}

const dir = 'data/fixtures/backtest'
mkdirSync(dir, { recursive: true })
const written = []
const skipped = []

for (const r of fetchData.results || []) {
  const c = r.case || {}
  const fe = r.fetch || {}
  const v = r.vet || {}
  const usable = fe.found && v && v.usable && !v.leaksOutcome
  if (!usable) {
    skipped.push({ id: c.caseId, why: !fe.found ? 'not-found' : v.leaksOutcome ? 'leaks' : 'not-usable' })
    continue
  }
  const idx = parseInt((c.caseId || 'case-0').slice(5), 10) - 1
  const g = gold[idx] || {}
  const text = sanitize(fe.resolutionText)
  if (text.length < 40) {
    skipped.push({ id: c.caseId, why: `too-short(${text.length})` })
    continue
  }
  const fixture = {
    market: {
      platform: c.platform,
      marketId: fe.marketIdentifier || c.caseId,
      question: question(c.marketTitle),
      resolutionText: text,
      resolutionSource: sanitize(fe.resolutionSource) || null,
      closeDate: fe.closeDate || c.resolved || null,
      expectedResolutionDate: fe.expectedResolutionDate || null,
      outcomes: parseOutcomes(fe.outcomes),
    },
    label: {
      caseId: c.caseId,
      marketTitle: c.marketTitle,
      wentToDispute: true,
      textDetectable: classify(g.verdict && g.verdict.wouldEngineHaveClues),
      expectedDimensions: c.dims || [],
      whatHappened: g.whatHappened || c.find || '',
      source: c.source || '',
    },
  }
  writeFileSync(`${dir}/${c.caseId}.json`, JSON.stringify(fixture, null, 2))
  written.push({ id: c.caseId, plat: c.platform, detect: fixture.label.textDetectable, len: text.length })
}

console.log(`WROTE ${written.length} fixtures:`)
for (const w of written) console.log(`  ${w.id}  ${w.plat.padEnd(11)}${w.detect.padEnd(8)}${w.len} chars`)
console.log(`SKIPPED ${skipped.length}: ${JSON.stringify(skipped)}`)
