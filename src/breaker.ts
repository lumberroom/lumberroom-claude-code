// The circuit breaker from lumberroom-openclaw src/recall.ts, as pure functions over plain data so
// its state can live in $.state and survive a hot reload.

import type { LumberroomBreaker } from '../types'

export const BREAKER_THRESHOLD = 3
export const BREAKER_COOLDOWN_MS = 60_000

export const CLOSED: LumberroomBreaker = { failures: 0, openedAt: null }

/**
 * Whether a call may go out at `now`. An open breaker past its cooldown closes: the result then
 * carries the reset state and `allowed: true`.
 */
export function allow(state: LumberroomBreaker, now: number): { allowed: boolean; state: LumberroomBreaker } {
  if (state.openedAt === null) return { allowed: true, state }
  if (now - state.openedAt >= BREAKER_COOLDOWN_MS) return { allowed: true, state: CLOSED }
  return { allowed: false, state }
}

export function success(): LumberroomBreaker {
  return CLOSED
}

/**
 * Records a failure. `startsOutage` is true for the first failure after a success or a reset, so
 * the caller tells the person once per outage. The breaker opens at BREAKER_THRESHOLD.
 */
export function failure(state: LumberroomBreaker, now: number): { state: LumberroomBreaker; startsOutage: boolean } {
  const failures = state.failures + 1
  return {
    state: { failures, openedAt: failures >= BREAKER_THRESHOLD ? now : state.openedAt },
    startsOutage: state.failures === 0,
  }
}
