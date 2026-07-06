import * as z from 'zod/v4'

// The verdict layer: a trader decides in ~3 seconds. Every analysis carries a
// structured verdict — lean, trap phrase, the ONE killer clause, and the so-what —
// rendered identically on every surface (page, board row, bot reply, digest item).
// The quality gate is code, not vibes: a verdict may never overclaim what the full
// analysis supports, so the killer clause must be a verbatim quote or the lean
// falls back to UNCLEAR.

export const SideStanceSchema = z.object({
  /** Does the fine print HELP or HURT a holder of this side? */
  stance: z.enum(['HELPS', 'HURTS', 'NEUTRAL', 'UNCLEAR']),
  /** <= 18 words, plain language, no jargon — written for someone's first market. */
  line: z.string(),
})

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
  /** The trade answer, per side: traders hold SIDES, and risk is directional. */
  yes_holder: SideStanceSchema.nullish(),
  no_holder: SideStanceSchema.nullish(),
  /** <= 15 words for existing position holders (key date, amendment risk), when applicable. */
  holder_note: z.string().nullish(),
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
  const lean = quotable ? v.lean : 'UNCLEAR'
  return {
    lean,
    lean_confidence: quotable ? v.lean_confidence : Math.min(v.lean_confidence, 0.4),
    trap_phrase: capWords(v.trap_phrase, 8),
    killer_clause: quotable ? clause : null,
    so_what: capWords(v.so_what, 15),
    ...gateSides(lean, v),
  }
}

type Stance = 'HELPS' | 'HURTS' | 'NEUTRAL' | 'UNCLEAR'

const capSide = (s: { stance: Stance; line: string } | null | undefined, words = 18) =>
  s ? { stance: s.stance, line: capWords(s.line, words) } : s

/**
 * Side-stance consistency, enforced in code:
 *  - a directional stance (HELPS/HURTS) is only allowed when the gated lean is
 *    directional — an UNCLEAR lean never sprouts asymmetric side advice;
 *  - stances may never CONTRADICT the lean (lean YES with yes_holder=HURTS or
 *    no_holder=HELPS is a contradiction → both sides collapse to UNCLEAR);
 *  - word caps by truncation.
 */
export function gateSides(
  lean: 'YES' | 'NO' | 'UNCLEAR',
  v: Pick<Verdict, 'yes_holder' | 'no_holder' | 'holder_note'>,
): Pick<Verdict, 'yes_holder' | 'no_holder' | 'holder_note'> {
  let yes = capSide(v.yes_holder)
  let no = capSide(v.no_holder)
  const note = v.holder_note ? capWords(v.holder_note, 15) : v.holder_note

  const collapse = (s: { stance: Stance; line: string } | null | undefined) =>
    s ? { stance: 'UNCLEAR' as Stance, line: s.line } : s

  if (yes || no) {
    const directional = (s?: { stance: Stance } | null) => s?.stance === 'HELPS' || s?.stance === 'HURTS'
    if (lean === 'UNCLEAR') {
      if (directional(yes)) yes = collapse(yes)
      if (directional(no)) no = collapse(no)
    } else {
      const favored = lean === 'YES' ? yes : no
      const disfavored = lean === 'YES' ? no : yes
      const contradiction = favored?.stance === 'HURTS' || disfavored?.stance === 'HELPS'
      if (contradiction) {
        yes = collapse(yes)
        no = collapse(no)
      }
    }
  }
  return { yes_holder: yes, no_holder: no, holder_note: note }
}
