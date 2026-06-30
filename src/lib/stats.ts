// Small statistics helpers. Kept dependency-free and deterministic.

export interface Interval {
  low: number
  high: number
}

/**
 * Wilson score interval for a binomial proportion. Far more honest than the naive
 * normal approximation at the small sample sizes this project lives at (n in the teens):
 * it never runs past [0, 1] and stays sensible even at 0 or 100% success.
 *
 * Returns the interval as proportions in [0, 1]. z defaults to 1.96 (95%).
 */
export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { low: 0, high: 1 }
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) }
}

/** Format a proportion (0–1) as a whole-number percent string, or a dash when undefined. */
export function asPct(p: number | null | undefined): string {
  return p == null ? '—' : `${Math.round(p * 100)}%`
}
