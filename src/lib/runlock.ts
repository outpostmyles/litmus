import { openSync, closeSync, writeFileSync, unlinkSync, readFileSync, existsSync } from 'node:fs'

// Minimal cross-process run lock (O_EXCL create). The JSON stores are whole-file
// last-writer-wins; two writers interleaving would drop grades or double-pay the
// LLM cache. Stale locks (dead pid) are reclaimed automatically.

export function acquireRunLock(path: string): boolean {
  try {
    const fd = openSync(path, 'wx')
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
  } catch {
    // Lock exists — reclaim only if its owner is gone.
    try {
      const pid = Number(readFileSync(path, 'utf8'))
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0) // throws when the process is dead
          return false // live owner
        } catch {
          /* dead owner — reclaim */
        }
      }
      unlinkSync(path)
      return acquireRunLock(path)
    } catch {
      return false
    }
  }
  const release = () => releaseRunLock(path)
  process.once('exit', release)
  process.once('SIGINT', () => {
    release()
    process.exit(130)
  })
  return true
}

export function releaseRunLock(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* best effort */
  }
}
