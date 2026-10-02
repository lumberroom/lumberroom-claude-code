// A bound on work that takes no signal. $.clock.sleep is the only wait a hook can use, so it is the
// timer. The slower arm keeps running; its result, or its rejection, is dropped.

export type Raced<T> = { timedOut: false; value: T } | { timedOut: true }

/**
 * Resolves with `work`'s value, or `{ timedOut: true }` once `sleep(ms)` finishes first. A
 * rejection from `work` before the timer propagates; one after it is swallowed.
 */
export async function raceSleep<T>(work: Promise<T>, sleep: (ms: number) => Promise<void>, ms: number): Promise<Raced<T>> {
  type Settled = { r: T } | { e: unknown } | { timeout: true }
  const arm: Promise<Settled> = work.then(
    (r) => ({ r }),
    (e: unknown) => ({ e }),
  )
  const timer: Promise<Settled> = sleep(ms).then(() => ({ timeout: true as const }))
  const won = await Promise.race([arm, timer])
  if ('timeout' in won) return { timedOut: true }
  if ('e' in won) throw won.e
  return { timedOut: false, value: won.r }
}
