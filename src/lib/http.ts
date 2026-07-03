// Shared resilient JSON fetcher for the platform APIs. One transient 429/500 from
// Kalshi or Gamma must not empty the day's catalog — the daily job runs unattended.

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_ATTEMPTS = 3

export interface GetJsonOpts {
  /** Total attempts including the first (default 3). */
  attempts?: number
  /** Per-attempt timeout in ms (default 15s). */
  timeoutMs?: number
}

/** Status codes worth retrying: transient server trouble or explicit throttling. */
function retryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * GET a JSON endpoint with exponential backoff, honoring Retry-After on 429/503.
 * Retries network errors and transient statuses; other 4xx (404 etc.) throw immediately —
 * a missing market is an answer, not an outage. Throws after the final attempt.
 */
export async function getJson(url: string, opts: GetJsonOpts = {}): Promise<any> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) return await res.json()
      if (!retryable(res.status) || i === attempts - 1) {
        // A definitive 4xx (404 etc.) is an answer, not an outage — never retried.
        const e = new Error(`${res.status} for ${url}`) as Error & { noRetry?: boolean }
        e.noRetry = !retryable(res.status)
        throw e
      }
      // Throttled or transient — wait out Retry-After when the server names a delay.
      const ra = Number(res.headers.get('retry-after'))
      const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** i + Math.random() * 250
      await sleep(Math.min(backoff, 15_000))
    } catch (err) {
      lastErr = err
      if ((err as { noRetry?: boolean })?.noRetry) throw err
      if (i === attempts - 1) throw err instanceof Error ? err : new Error(String(err))
      await sleep(500 * 2 ** i + Math.random() * 250)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`failed: ${url}`)
}

/** getJson that returns null instead of throwing — for best-effort paths (settle, lookups). */
export async function tryGetJson(url: string, opts: GetJsonOpts = {}): Promise<any | null> {
  try {
    return await getJson(url, opts)
  } catch {
    return null
  }
}
