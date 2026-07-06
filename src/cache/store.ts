import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

// Local, accounts-free cache. Scores are keyed by a hash of the resolution text,
// so many markets sharing one rulebook (e.g. every "Will X win the World Cup?")
// collapse to a single score and a single model call.
export const CATALOG_PATH = 'data/cache/catalog.json'
export const SCORES_PATH = 'data/cache/scores.json'

export function rulebookHash(platform: string, resolutionText: string): string {
  const norm = resolutionText.replace(/\s+/g, ' ').trim().toLowerCase()
  return createHash('sha256').update(`${platform}\n${norm}`).digest('hex').slice(0, 16)
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

export interface CatalogEntry {
  platform: string
  marketId: string
  rulebookHash: string
  question: string
  category: string
  resolutionText: string
  resolutionSource: string | null
  outcomes: string[]
  closeDate: string | null
  /** Representative market volume (Kalshi: contracts; Polymarket: USD). */
  volume: number
  /** How many markets share this rulebook (fan-out size). */
  marketCount: number
  /** Aggregate volume across the group. */
  totalVolume: number
  /** Current implied probability of "Yes" (0–1), or null. Refreshed on ingest. */
  priceYes: number | null
  priceAsOf: string | null
  url: string | null
  fetchedAt: string
  /** Which lane discovered this market: the daily sweep or the fast-scan watcher. */
  scanLane?: 'daily' | 'fast'
  /** When the fast-scan watcher first saw the market listed. */
  detectedAt?: string
  /**
   * Individual legs of a fan-out family (candidates/teams/strikes sharing this
   * rulebook). Present when marketCount > 1 — what makes leg-level cross-venue
   * matching and honest pair grading possible.
   */
  legs?: { marketId: string; label: string; priceYes: number | null; volume: number }[]
}

export interface CachedScore {
  combined: number
  band: string
  dimensions: {
    key: string
    label: string
    score: number
    weight: number
    reasoning: string
    offendingClause: string | null
  }[]
  namedSource: string | null
  assumedVsActual: string | null
  headlineRisk: string
  summary: string
  model: string
  scoredAt: string
  /** Directional lean of the literal rules (added by the cheap enrichment pass). */
  literalFavors?: 'yes' | 'no' | 'neither'
  literalFavorsNote?: string
  /** How confident the lean pass is in that direction (0–1). Edges require ≥0.55. */
  leanConfidence?: number
  /** Verbatim rules span forcing the divergence — demanded when confidence ≥0.85. */
  leanClauseQuote?: string | null
  /** True when the current price is already consistent with a correct literal reading. */
  leanCrowdConsistent?: boolean
  /** Provenance: which lane produced this score, and when the market was detected. */
  scanLane?: 'daily' | 'fast'
  detectedAt?: string
  /** The 3-second layer (code-gated). Backfilled for old scores; native on new ones. */
  verdict?: {
    lean: 'YES' | 'NO' | 'UNCLEAR'
    lean_confidence: number
    trap_phrase: string
    killer_clause: string | null
    so_what: string
    /** Per-side trade answer (P11): risk is directional — holders hold SIDES. */
    yes_holder?: { stance: 'HELPS' | 'HURTS' | 'NEUTRAL' | 'UNCLEAR'; line: string } | null
    no_holder?: { stance: 'HELPS' | 'HURTS' | 'NEUTRAL' | 'UNCLEAR'; line: string } | null
    holder_note?: string | null
  }
}

export function loadCatalog(): CatalogEntry[] {
  return readJson<CatalogEntry[]>(CATALOG_PATH, [])
}
export function saveCatalog(c: CatalogEntry[]): void {
  writeJson(CATALOG_PATH, c)
}
export function loadScores(): Record<string, CachedScore> {
  return readJson<Record<string, CachedScore>>(SCORES_PATH, {})
}
export function saveScores(s: Record<string, CachedScore>): void {
  writeJson(SCORES_PATH, s)
}
