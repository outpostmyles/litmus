import * as z from 'zod/v4'

// The verdict layer: a trader decides in ~3 seconds. Every analysis carries a
// structured verdict — lean, trap phrase, the ONE killer clause, and the so-what —
// rendered identically on every surface (page, board row, bot reply, digest item).
// The quality gate is code, not vibes: a verdict may never overclaim what the full
// analysis supports, so the killer clause must be a verbatim quote or the lean
// falls back to UNCLEAR.

export const VerdictSchema = z.object({
  /** Which side the LITERAL rules favor for a casual holder. UNCLEAR when the text can't say. */
  lean: z.enum(['YES', 'NO', 'UNCLEAR']),
  lean_confidence: z.number().min(0).max(1),
  /** <= 8 words: the single most dangerous concept ("partial control counts"). */
  trap_phrase: z.string(),
  /** Verbatim quote of the ONE worst clause. Null when nothing is quotable. */
  killer_clause: z.string().nullable(),
  /** <= 15 words: what a holder should understand. */
  so_what: z.string(),
})

export type Verdict = z.infer<typeof VerdictSchema>

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase()

const capWords = (s: string, n: number) => {
  const words = s.trim().split(/\s+/)
  return words.length <= n ? s.trim() : words.slice(0, n).join(' ')
}

/**
 * Enforce the verdict contract in code:
 *  - killer_clause must appear VERBATIM in the source material (rules text, or the
 *    analysis's stored offending clauses for backfilled verdicts). No quote → the
 *    lean collapses to UNCLEAR and the clause is dropped: the short layer must
 *    never assert more than the long layer supports.
 *  - trap_phrase / so_what word caps enforced by truncation.
 */
export function gateVerdict(v: Verdict, sources: (string | null | undefined)[]): Verdict {
  const haystack = norm(sources.filter(Boolean).join('\n'))
  const clause = v.killer_clause?.trim() || null
  const quotable = clause != null && clause.length >= 8 && haystack.includes(norm(clause))
  return {
    lean: quotable ? v.lean : 'UNCLEAR',
    lean_confidence: quotable ? v.lean_confidence : Math.min(v.lean_confidence, 0.4),
    trap_phrase: capWords(v.trap_phrase, 8),
    killer_clause: quotable ? clause : null,
    so_what: capWords(v.so_what, 15),
  }
}
