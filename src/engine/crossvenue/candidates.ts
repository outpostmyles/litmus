// Stage 1 of the cross-venue engine: cheap, deterministic candidate generation.
// Finds Kalshi×Polymarket market pairs that MIGHT reference the same real-world
// event, using only structured signals — no model calls. Pairs above threshold go
// to LLM confirmation (stage 2). Blocking keeps the comparison count subquadratic:
// only pairs sharing a block key (an informative entity token, or a close-week)
// are ever scored, so a 10x bigger universe doesn't mean a 100x bigger loop.

export interface CandidateMarket {
  rulebookHash: string
  platform: string
  question: string
  category: string
  closeDate: string | null
  priceYes: number | null
}

export interface CandidatePair {
  kalshiHash: string
  polyHash: string
  score: number
  sharedTokens: string[]
}

/** Words that carry no event identity — market-speak, glue, and bare hype. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'by', 'to', 'for', 'and', 'or', 'be',
  'is', 'are', 'was', 'were', 'will', 'would', 'can', 'could', 'do', 'does', 'did',
  'has', 'have', 'had', 'this', 'that', 'it', 'its', 'their', 'his', 'her', 'any',
  'what', 'which', 'who', 'when', 'how', 'many', 'much', 'there', 'before', 'after',
  'during', 'until', 'end', 'start', 'year', 'month', 'day', 'week', 'next', 'new',
  'win', 'wins', 'winner', 'won', 'happen', 'happens', 'occur', 'occurs', 'get',
  'gets', 'go', 'goes', 'out', 'up', 'down', 'over', 'under', 'above', 'below',
  'market', 'question', 'resolve', 'resolves', 'yes', 'no', 'vs',
])

/**
 * Cross-venue phrasing aliases: both venues describe the same underlying entity or
 * action with different house vocabulary. Applied token-by-token after lowering.
 */
const ALIASES: Record<string, string> = {
  us: 'usa',
  'u.s': 'usa',
  america: 'usa',
  american: 'usa',
  states: 'usa',
  acquire: 'buy',
  acquires: 'buy',
  purchase: 'buy',
  buys: 'buy',
  bought: 'buy',
  invades: 'invade',
  invasion: 'invade',
  resign: 'depart',
  resigns: 'depart',
  departure: 'depart',
  leave: 'depart',
  leaves: 'depart',
  impeached: 'impeach',
  impeachment: 'impeach',
  bitcoin: 'btc',
  ethereum: 'eth',
}

/**
 * Collocations folded to one token BEFORE single-token aliasing. Bigram-aware on
 * purpose: a bare "cup" must NOT become "worldcup" (Stanley Cup ≠ World Cup) and a
 * bare "reserve" must not become "fed" (Strategic Bitcoin Reserve ≠ Federal Reserve).
 */
const COLLOCATIONS: [string, string, string][] = [
  ['world', 'cup', 'worldcup'],
  ['federal', 'reserve', 'fed'],
]

function foldCollocations(ts: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < ts.length; i++) {
    const pair = COLLOCATIONS.find(([a, b]) => ts[i] === a && ts[i + 1] === b)
    if (pair) {
      out.push(pair[2])
      i++
    } else {
      out.push(ts[i]!)
    }
  }
  return out
}

/** Lowercase, strip punctuation, fold collocations, alias, drop stopwords. Keeps years and numbers. */
export function tokens(question: string): string[] {
  const raw = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$%.]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
  return foldCollocations(raw)
    .map((t) => ALIASES[t] ?? t)
    .filter((t) => !STOPWORDS.has(t) && t.length > 1)
}

/**
 * Entity-ish tokens: capitalized words and ALL-CAPS acronyms (EU, UK, AI) from the
 * ORIGINAL casing, tickers, dollar amounts, and 4-digit years. Cheap stand-in for NER.
 */
export function entityTokens(question: string): string[] {
  const caps: string[] = []
  for (const m of question.matchAll(/\b(?:[A-Z][a-zA-Z]{2,}|[A-Z]{2,})\b/g)) caps.push(m[0].toLowerCase())
  const out = new Set<string>()
  for (const t of foldCollocations(caps)) {
    const aliased = ALIASES[t] ?? t
    if (!STOPWORDS.has(aliased) && aliased.length > 1) out.add(aliased)
  }
  for (const m of question.matchAll(/\$[\d,.]+[kKmMbB]?|\b(19|20)\d{2}\b/g)) {
    out.add(m[0].toLowerCase().replace(/[.,]+$/, ''))
  }
  return [...out]
}

/**
 * Coarse 7-day close-date bucket (days-since-epoch / 7 — NOT ISO weeks). Used only
 * for blocking, and always queried together with its neighbors so a one-day gap
 * across a bucket boundary (incl. Dec 31 → Jan 1) can never split a pair.
 */
export function closeWeek(closeDate: string | null): number | null {
  if (!closeDate) return null
  const t = Date.parse(closeDate)
  if (!Number.isFinite(t)) return null
  return Math.floor(t / (7 * 86_400_000))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Days between close dates; Infinity when either is missing/unparseable. */
export function closeGapDays(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity
  return Math.abs(ta - tb) / 86_400_000
}

export interface CandidateOpts {
  /** Pairs must score at least this to become candidates. */
  threshold?: number
  /** Close dates further apart than this contribute zero date affinity. */
  closeWindowDays?: number
}

/**
 * Score one cross-venue pair from structured signals. 0–1.
 *  - token overlap (Jaccard on normalized informative tokens): the workhorse
 *  - entity overlap: names/tickers/years agreeing is stronger evidence than glue words
 *  - close-date proximity: same event usually means close dates within weeks
 */
export function pairScore(
  a: CandidateMarket,
  b: CandidateMarket,
  opts: CandidateOpts = {},
): { score: number; sharedTokens: string[] } {
  const window = opts.closeWindowDays ?? 60
  const ta = new Set(tokens(a.question))
  const tb = new Set(tokens(b.question))
  const ea = new Set(entityTokens(a.question))
  const eb = new Set(entityTokens(b.question))

  const tokenSim = jaccard(ta, tb)
  const entitySim = jaccard(ea, eb)
  const gap = closeGapDays(a.closeDate, b.closeDate)
  const dateAffinity = gap === Infinity ? 0.3 : Math.max(0, 1 - gap / window) // unknown ≠ disqualifying

  const score = 0.5 * tokenSim + 0.3 * entitySim + 0.2 * dateAffinity
  const shared = [...ta].filter((t) => tb.has(t))
  return { score, sharedTokens: shared }
}

/**
 * Generate candidate pairs across venues with blocking: a pair is only scored when
 * the two markets share an entity token or a close-week. Returns pairs at/above the
 * threshold, sorted by score descending.
 */
export function generateCandidates(
  kalshi: CandidateMarket[],
  poly: CandidateMarket[],
  opts: CandidateOpts = {},
): CandidatePair[] {
  const threshold = opts.threshold ?? 0.3

  // Bare years block nearly everything with everything (half the catalog says
  // "2026") — they stay in the SCORING token sets but make useless block keys.
  const isBareYear = (t: string) => /^(19|20)\d{2}$/.test(t)
  // Entity keys when available; top informative tokens as fallback so lowercase-heavy
  // titles (common on Polymarket) still enter blocks.
  const blockTokens = (q: string): string[] => {
    const ents = entityTokens(q).filter((t) => !isBareYear(t))
    if (ents.length) return ents
    return tokens(q)
      .filter((t) => !isBareYear(t))
      .slice(0, 4)
  }

  // Build block index over the Polymarket side: block key -> market indices.
  const blocks = new Map<string, Set<number>>()
  const add = (key: string, i: number) => {
    const s = blocks.get(key) ?? new Set<number>()
    s.add(i)
    blocks.set(key, s)
  }
  poly.forEach((m, i) => {
    for (const e of blockTokens(m.question)) add(`e:${e}`, i)
    const w = closeWeek(m.closeDate)
    if (w != null) add(`w:${w}`, i)
  })

  const out: CandidatePair[] = []
  const seen = new Set<string>()
  for (const k of kalshi) {
    const candidateIdx = new Set<number>()
    for (const e of blockTokens(k.question)) for (const i of blocks.get(`e:${e}`) ?? []) candidateIdx.add(i)
    // Query the week bucket AND its neighbors: a one-day gap across a bucket
    // boundary (incl. Dec 31 → Jan 1) must never split a pair.
    const w = closeWeek(k.closeDate)
    if (w != null) {
      for (const wk of [w - 1, w, w + 1]) for (const i of blocks.get(`w:${wk}`) ?? []) candidateIdx.add(i)
    }

    for (const i of candidateIdx) {
      const p = poly[i]!
      const key = `${k.rulebookHash}:${p.rulebookHash}`
      if (seen.has(key)) continue
      seen.add(key)
      const { score, sharedTokens } = pairScore(k, p, opts)
      if (score >= threshold) {
        out.push({ kalshiHash: k.rulebookHash, polyHash: p.rulebookHash, score, sharedTokens })
      }
    }
  }
  return out.sort((a, b) => b.score - a.score)
}
