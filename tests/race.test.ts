import { describe, expect, test } from 'claude-code/testing'

import { raceSleep } from '../src/race'

const never = () => new Promise<never>(() => {})

describe('raceSleep', () => {
  test('returns the value when the work wins', async () => {
    expect(await raceSleep(Promise.resolve(7), never, 100)).toEqual({ timedOut: false, value: 7 })
  })

  test('reports a timeout when the timer wins, and passes the bound to sleep', async () => {
    const asked: number[] = []
    const raced = await raceSleep(never(), (ms) => (asked.push(ms), Promise.resolve()), 250)
    expect(raced).toEqual({ timedOut: true })
    expect(asked).toEqual([250])
  })

  test('propagates a rejection that comes before the timer', async () => {
    await expect(raceSleep(Promise.reject(new Error('boom')), never, 100)).rejects.toThrow('boom')
  })

  test('swallows a rejection that comes after the timer, so nothing is left unhandled', async () => {
    let fail: (e: Error) => void = () => {}
    const late = new Promise<never>((_, reject) => {
      fail = reject
    })
    const raced = await raceSleep(late, () => Promise.resolve(), 10)
    expect(raced.timedOut).toBe(true)
    fail(new Error('late'))
    await Promise.resolve()
  })
})
