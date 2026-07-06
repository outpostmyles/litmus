// Leg-level matching: pair the individual candidates/teams/strikes of two matched
// fan-out families across venues. This is what makes pairs GRADEABLE — a family's
// representative markets are arbitrary (Rubio vs LeBron), but "France wins" on
// Kalshi and "France wins" on Polymarket are the same contract-sized claim.
// Deterministic and free: label normalization + unique assignment, no model calls.

export interface Leg {
  /** Venue market id (Kalshi ticker / Polymarket numeric id). */
  marketId: string
  /** Human label: Kalshi yes_sub_title / Polymarket groupItemTitle. */
  label: string
  priceYes: number | null
  volume: number
}

export interface LegMatch {
  kalshi: Leg
  poly: Leg
  /** Canonical label (normalized, for keys and display). */
  label: string
  /** 'exact' = normalized labels identical → same-event at leg level.
   *  'fuzzy' = token containment — kept visible but graded conservatively. */
  quality: 'exact' | 'fuzzy'
}

/** Person/country phrasing folds so venue label styles meet in the middle. */
const LABEL_ALIASES: Record<string, string> = {
  usa: 'united states',
  us: 'united states',
  america: 'united states',
  uk: 'united kingdom',
  britain: 'united kingdom',
  uae: 'united arab emirates',
  drc: 'dr congo',
  'south korea': 'korea republic',
  ivory: 'ivory coast',
}

const LABEL_STOP = new Set(['the', 'of', 'republic', 'fc', 'team'])

export function normalizeLegLabel(label: string): string {
  let s = label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  s = LABEL_ALIASES[s] ?? s
  const raw = s.split(' ').filter((t) => !LABEL_STOP.has(t) && t.length > 0)
  // Fold initials: a run of single letters becomes one token ("J.D." → "j d" → "jd"),
  // so venue styling of the same name can't split a match.
  const tokens: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]!.length === 1) {
      let merged = raw[i]!
      while (i + 1 < raw.length && raw[i + 1]!.length === 1) merged += raw[++i]!
      tokens.push(merged)
    } else {
      tokens.push(raw[i]!)
    }
  }
  return tokens.sort().join(' ')
}

/** Token-set containment: is one label's token set a subset of the other's? */
function contains(a: string, b: string): boolean {
  const ta = new Set(a.split(' '))
  const tb = new Set(b.split(' '))
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
  if (small.size === 0) return false
  for (const t of small) if (!big.has(t)) return false
  return true
}

/**
 * Match legs across venues with unique assignment: exact normalized matches first,
 * then unambiguous containment matches ("Gavin Newsom" ⊆ "Gavin Newsom (D)"). A leg
 * that could match two counterparts matches none — ambiguity is never guessed away.
 */
export function matchLegs(kalshiLegs: Leg[], polyLegs: Leg[]): LegMatch[] {
  const out: LegMatch[] = []
  const usedK = new Set<string>()
  const usedP = new Set<string>()

  const kNorm = kalshiLegs.map((l) => ({ leg: l, norm: normalizeLegLabel(l.label) })).filter((x) => x.norm)
  const pNorm = polyLegs.map((l) => ({ leg: l, norm: normalizeLegLabel(l.label) })).filter((x) => x.norm)

  // Pass 1: exact.
  const pByNorm = new Map<string, typeof pNorm>()
  for (const p of pNorm) {
    const arr = pByNorm.get(p.norm) ?? []
    arr.push(p)
    pByNorm.set(p.norm, arr)
  }
  for (const k of kNorm) {
    const cands = pByNorm.get(k.norm) ?? []
    // Unique on both sides: exactly one candidate, and no other Kalshi leg shares the norm.
    const kSame = kNorm.filter((x) => x.norm === k.norm)
    if (cands.length === 1 && kSame.length === 1) {
      out.push({ kalshi: k.leg, poly: cands[0]!.leg, label: k.norm, quality: 'exact' })
      usedK.add(k.leg.marketId)
      usedP.add(cands[0]!.leg.marketId)
    }
  }

  // Pass 2: containment, unique both directions among the unmatched.
  const kLeft = kNorm.filter((x) => !usedK.has(x.leg.marketId))
  const pLeft = pNorm.filter((x) => !usedP.has(x.leg.marketId))
  for (const k of kLeft) {
    const cands = pLeft.filter((p) => !usedP.has(p.leg.marketId) && contains(k.norm, p.norm))
    if (cands.length !== 1) continue
    const p = cands[0]!
    const reverse = kLeft.filter((x) => !usedK.has(x.leg.marketId) && contains(x.norm, p.norm))
    if (reverse.length !== 1) continue
    out.push({ kalshi: k.leg, poly: p.leg, label: k.norm, quality: 'fuzzy' })
    usedK.add(k.leg.marketId)
    usedP.add(p.leg.marketId)
  }

  return out
}
