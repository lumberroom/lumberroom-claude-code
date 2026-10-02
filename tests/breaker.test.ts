import { describe, expect, test } from 'claude-code/testing'

import { allow, BREAKER_COOLDOWN_MS, CLOSED, failure, success } from '../src/breaker'

describe('breaker', () => {
  test('a closed breaker allows', async () => {
    expect(allow(CLOSED, 0)).toEqual({ allowed: true, state: CLOSED })
  })

  test('opens after three failures', async () => {
    let s = CLOSED
    s = failure(s, 100).state
    s = failure(s, 200).state
    expect(allow(s, 300).allowed).toBe(true)
    s = failure(s, 300).state
    expect(s.openedAt).toBe(300)
    expect(allow(s, 301).allowed).toBe(false)
  })

  test('startsOutage only on the first failure after a success or reset', async () => {
    const a = failure(CLOSED, 1)
    expect(a.startsOutage).toBe(true)
    const b = failure(a.state, 2)
    expect(b.startsOutage).toBe(false)
    const c = failure(success(), 3)
    expect(c.startsOutage).toBe(true)
  })

  test('startsOutage is true again after the cooldown reset', async () => {
    let s = CLOSED
    for (let i = 0; i < 3; i++) s = failure(s, 10).state
    const reset = allow(s, 10 + BREAKER_COOLDOWN_MS)
    expect(failure(reset.state, 10 + BREAKER_COOLDOWN_MS + 1).startsOutage).toBe(true)
  })

  test('stays shut one millisecond before the cooldown ends', async () => {
    let s = CLOSED
    for (let i = 0; i < 3; i++) s = failure(s, 1000).state
    const r = allow(s, 1000 + BREAKER_COOLDOWN_MS - 1)
    expect(r.allowed).toBe(false)
    expect(r.state).toEqual(s)
  })

  test('closes and resets after the 60 s cooldown', async () => {
    let s = CLOSED
    for (let i = 0; i < 3; i++) s = failure(s, 1000).state
    const r = allow(s, 1000 + BREAKER_COOLDOWN_MS)
    expect(r.allowed).toBe(true)
    expect(r.state).toEqual({ failures: 0, openedAt: null })
  })

  test('success resets the failure count', async () => {
    let s = failure(failure(CLOSED, 1).state, 2).state
    s = success()
    expect(s).toEqual({ failures: 0, openedAt: null })
    s = failure(failure(s, 3).state, 4).state
    expect(allow(s, 5).allowed).toBe(true)
  })

  test('failure does not mutate its input', async () => {
    const before = { failures: 1, openedAt: null }
    failure(before, 5)
    expect(before).toEqual({ failures: 1, openedAt: null })
  })
})
