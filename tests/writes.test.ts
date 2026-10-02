import { describe, expect, test } from 'claude-code/testing'

import type { CallOutcome } from '../src/mcp'
import {
  AUTO_TAG,
  IN_FLIGHT_TTL_MS,
  conflictsFrom,
  factKey,
  liveHeadFrom,
  normalizeContent,
  writeFact,
  type Conflict,
  type Fact,
  type WriteDeps,
} from '../src/writes'

const HEAD = '5d0b7a52-3c1f-4c0e-9a77-0c1f2f6d9e11'
const OLD = '11111111-2222-4333-8444-555555555555'
const SECOND = '99999999-8888-4777-8666-555555555555'

const ok = (data: unknown): CallOutcome => ({ kind: 'ok', data, text: JSON.stringify(data), ms: 5 })
const fact: Fact = { content: 'The API port is 8443.', namespace: 'project:x', tags: ['infra'] }

function harness(outcomes: CallOutcome[], judge: (c: Conflict) => boolean = () => false, start = 1_000_000) {
  const calls: Record<string, unknown>[] = []
  const searched: string[] = []
  // A test sets `similar` before it writes; 'throw' makes the search reject.
  const search: { similar: Conflict[] | 'throw' } = { similar: [] }
  const judged: string[] = []
  const mem = new Map<string, unknown>()
  let clock = start
  const deps: WriteDeps = {
    write: async (args) => {
      calls.push(args)
      return outcomes[calls.length - 1] ?? { kind: 'timeout', ms: 1 }
    },
    store: {
      get: async (k) => mem.get(k),
      set: async (k, v) => {
        mem.set(k, v)
      },
    },
    findSimilar: async (f) => {
      searched.push(f.content)
      if (search.similar === 'throw') throw new Error('search is down')
      return search.similar
    },
    isOldVersion: async (_f, c) => {
      judged.push(c.id)
      return judge(c)
    },
    now: async () => clock,
  }
  return { deps, calls, judged, searched, search, mem, advance: (ms: number) => (clock += ms) }
}

describe('normalizeContent', () => {
  test('lowercases, collapses whitespace and drops one trailing period', async () => {
    expect(normalizeContent('  The  API\nport   is 8443.  ')).toBe('the api port is 8443')
  })
})

describe('factKey', () => {
  test('is stable for equivalent content', async () => {
    const a = await factKey({ content: 'Port is 8443.', namespace: 'global' })
    const b = await factKey({ content: '  port  is 8443', namespace: 'global' })
    expect(a).toBe(b)
    expect(a.startsWith('lr-write:')).toBe(true)
    expect(a.length).toBe('lr-write:'.length + 64)
  })
  test('differs by namespace', async () => {
    const a = await factKey({ content: 'x', namespace: 'global' })
    const b = await factKey({ content: 'x', namespace: 'user:me' })
    expect(a === b).toBe(false)
  })
})

describe('conflictsFrom', () => {
  test('reads well-formed entries', async () => {
    const got = conflictsFrom({ id: 'n', possible_conflicts: [{ id: OLD, namespace: 'global', content: 'c', similarity: 0.9 }] })
    expect(got).toEqual([{ id: OLD, namespace: 'global', content: 'c', similarity: 0.9 }])
  })
  test('returns [] for absent, non-array and non-object data', async () => {
    expect(conflictsFrom({})).toEqual([])
    expect(conflictsFrom({ possible_conflicts: 'x' })).toEqual([])
    expect(conflictsFrom(null)).toEqual([])
    expect(conflictsFrom('text')).toEqual([])
  })
  test('skips malformed entries and keeps good ones', async () => {
    const got = conflictsFrom({ possible_conflicts: [{ id: 1 }, null, { id: OLD, namespace: 'g', content: 'c' }] })
    expect(got.map((c) => c.id)).toEqual([OLD])
  })
})

describe('liveHeadFrom', () => {
  test('reads the live row from the engine message, not the target id', async () => {
    const msg = `memory ${OLD} was already superseded. The live row is ${HEAD}; retry with supersedes set to it if this write replaces that.`
    expect(liveHeadFrom(msg)).toBe(HEAD)
  })
  test('returns null when the message names no head', async () => {
    expect(liveHeadFrom(`memory ${OLD} was already superseded`)).toBe(null)
    expect(liveHeadFrom('content is empty')).toBe(null)
    expect(liveHeadFrom('')).toBe(null)
  })
})

describe('writeFact', () => {
  test('a plain write is written and marks the key done', async () => {
    const h = harness([ok({ id: 'n1', deduplicated: false })])
    const r = await writeFact(h.deps, fact)
    expect(r).toEqual({ status: 'written', id: 'n1' })
    expect(h.mem.get(await factKey(fact))).toEqual({ state: 'done', id: 'n1' })
    expect(h.calls.length).toBe(1)
  })

  test('tags always include auto-extract exactly once', async () => {
    const h1 = harness([ok({ id: 'a' })])
    await writeFact(h1.deps, { ...fact, tags: ['infra', AUTO_TAG, 'infra'] })
    expect(h1.calls[0]?.tags).toEqual(['infra', AUTO_TAG])
    const h2 = harness([ok({ id: 'b' })])
    await writeFact(h2.deps, { content: 'z', namespace: 'global' })
    expect(h2.calls[0]?.tags).toEqual([AUTO_TAG])
    expect(h2.calls[0]).toEqual({ content: 'z', namespace: 'global', tags: [AUTO_TAG] })
  })

  test('deduplicated:true returns deduplicated', async () => {
    const h = harness([ok({ id: 'n1', deduplicated: true })])
    expect(await writeFact(h.deps, fact)).toEqual({ status: 'deduplicated', id: 'n1' })
    expect(h.mem.get(await factKey(fact))).toEqual({ state: 'done', id: 'n1' })
  })

  test('the first similar row judged old version becomes the single call\'s supersedes', async () => {
    const h = harness([ok({ id: 'n1' })], (c) => c.id === SECOND)
    h.search.similar = [
      { id: OLD, namespace: 'project:x', content: 'a', similarity: 0.9 },
      { id: SECOND, namespace: 'project:x', content: 'b', similarity: 0.8 },
    ]
    const r = await writeFact(h.deps, fact)
    expect(h.searched).toEqual([fact.content])
    expect(h.judged).toEqual([OLD, SECOND])
    expect(h.calls.length).toBe(1)
    expect(h.calls[0]?.supersedes).toBe(SECOND)
    expect(r).toEqual({ status: 'written', id: 'n1', superseded: SECOND })
    expect(h.mem.get(await factKey(fact))).toEqual({ state: 'done', id: 'n1' })
  })

  test('stops judging at the first old version', async () => {
    const h = harness([ok({ id: 'n1' })], () => true)
    h.search.similar = [
      { id: OLD, namespace: 'project:x', content: 'a' },
      { id: SECOND, namespace: 'project:x', content: 'b' },
    ]
    await writeFact(h.deps, fact)
    expect(h.judged).toEqual([OLD])
    expect(h.calls[0]?.supersedes).toBe(OLD)
  })

  test('no old version writes without supersedes', async () => {
    const h = harness([ok({ id: 'n1' })])
    h.search.similar = [{ id: OLD, namespace: 'g', content: 'a' }]
    const r = await writeFact(h.deps, fact)
    expect(h.calls.length).toBe(1)
    expect('supersedes' in (h.calls[0] ?? {})).toBe(false)
    expect(r).toEqual({ status: 'written', id: 'n1' })
  })

  test('possible_conflicts come back on the result and no second call is made', async () => {
    const conflicts = [{ id: OLD, namespace: 'project:x', content: 'a', similarity: 0.8 }]
    const h = harness([ok({ id: 'n1', possible_conflicts: conflicts }), ok({ id: 'n2' })], () => true)
    const r = await writeFact(h.deps, fact)
    expect(h.calls.length).toBe(1)
    expect(r).toEqual({ status: 'written', id: 'n1', conflicts })
    expect(h.mem.get(await factKey(fact))).toEqual({ state: 'done', id: 'n1' })
  })

  test('a failing findSimilar gives a plain write', async () => {
    const h = harness([ok({ id: 'n1' })], () => true)
    h.search.similar = 'throw'
    const r = await writeFact(h.deps, fact)
    expect(h.judged).toEqual([])
    expect(h.calls.length).toBe(1)
    expect('supersedes' in (h.calls[0] ?? {})).toBe(false)
    expect(r).toEqual({ status: 'written', id: 'n1' })
  })

  test('a throwing isOldVersion skips that candidate', async () => {
    const h = harness([ok({ id: 'n1' })])
    h.search.similar = [{ id: OLD, namespace: 'g', content: 'a' }]
    h.deps.isOldVersion = async () => {
      throw new Error('model is down')
    }
    const r = await writeFact(h.deps, fact)
    expect(h.calls.length).toBe(1)
    expect(r).toEqual({ status: 'written', id: 'n1' })
  })

  test('a live-head error on the supersedes call retries once with the head', async () => {
    const text = `memory ${OLD} was already superseded. The live row is ${HEAD}; retry with supersedes set to it if this write replaces that.`
    const h = harness([{ kind: 'tool_error', text, ms: 3 }, ok({ id: 'n2' }), ok({ id: 'n3' })], () => true)
    h.search.similar = [{ id: OLD, namespace: 'g', content: 'a' }]
    const r = await writeFact(h.deps, fact)
    expect(h.calls.map((c) => c.supersedes)).toEqual([OLD, HEAD])
    expect(r).toEqual({ status: 'written', id: 'n2', superseded: HEAD })
  })

  test('a tool_error on the first call naming a live head retries with it', async () => {
    const text = `memory ${OLD} was already superseded. The live row is ${HEAD}; retry with supersedes set to it if this write replaces that.`
    const h = harness([{ kind: 'tool_error', text, ms: 3 }, ok({ id: 'n2', superseded: HEAD })])
    const r = await writeFact(h.deps, fact)
    expect(h.calls.length).toBe(2)
    expect(h.calls[1]?.supersedes).toBe(HEAD)
    expect(r).toEqual({ status: 'written', id: 'n2', superseded: HEAD })
  })

  test('a second tool_error ends in failed with no third call', async () => {
    const text = `The live row is ${HEAD}; retry with supersedes set to it`
    const h = harness([{ kind: 'tool_error', text, ms: 3 }, { kind: 'tool_error', text, ms: 3 }, ok({ id: 'x' })])
    const r = await writeFact(h.deps, fact)
    expect(h.calls.length).toBe(2)
    expect(r.status).toBe('failed')
    expect(h.mem.get(await factKey(fact)) ?? null).toBe(null)
  })

  test('a tool_error naming no head is refused after one call, and the key says so', async () => {
    const h = harness([{ kind: 'tool_error', text: 'content is empty', ms: 1 }])
    const r = await writeFact(h.deps, fact)
    expect(h.calls.length).toBe(1)
    expect(r).toEqual({ status: 'refused', error: 'tool_error: content is empty' })
    expect(h.mem.get(await factKey(fact))).toEqual({ state: 'refused', at: 1_000_000 })
  })

  test('a refused key is skipped with no call, so the same fact is not sent again', async () => {
    const h = harness([{ kind: 'tool_error', text: 'refusing to store this at open', ms: 1 }, ok({ id: 'n1' })])
    await writeFact(h.deps, fact)
    expect(await writeFact(h.deps, fact)).toEqual({ status: 'skipped', reason: 'refused-before' })
    expect(h.calls.length).toBe(1)
  })

  test('a tool_error on the retry that followed a live head stays failed, not refused', async () => {
    const text = `The live row is ${HEAD}; retry with supersedes set to it`
    const h = harness([{ kind: 'tool_error', text, ms: 3 }, { kind: 'tool_error', text: 'content is empty', ms: 3 }])
    expect((await writeFact(h.deps, fact)).status).toBe('failed')
  })

  test('a done key skips with no call', async () => {
    const h = harness([ok({ id: 'n1' })])
    h.mem.set(await factKey(fact), { state: 'done', id: 'old' })
    expect(await writeFact(h.deps, fact)).toEqual({ status: 'skipped', reason: 'sent-before' })
    expect(h.calls.length).toBe(0)
  })

  test('a young in-flight key skips with no call', async () => {
    const h = harness([ok({ id: 'n1' })])
    h.mem.set(await factKey(fact), { state: 'in-flight', at: 1_000_000 - IN_FLIGHT_TTL_MS + 1000 })
    expect(await writeFact(h.deps, fact)).toEqual({ status: 'skipped', reason: 'in-flight' })
    expect(h.calls.length).toBe(0)
  })

  test('an in-flight key older than the TTL is sent again', async () => {
    const h = harness([ok({ id: 'n1' })])
    h.mem.set(await factKey(fact), { state: 'in-flight', at: 1_000_000 - IN_FLIGHT_TTL_MS - 1 })
    expect((await writeFact(h.deps, fact)).status).toBe('written')
    expect(h.calls.length).toBe(1)
  })

  test('the in-flight mark is set before the call', async () => {
    const h = harness([ok({ id: 'n1' })])
    const key = await factKey(fact)
    let seen: unknown
    const inner = h.deps.write
    h.deps.write = async (args) => {
      seen = h.mem.get(key)
      return inner(args)
    }
    await writeFact(h.deps, fact)
    expect(seen).toEqual({ state: 'in-flight', at: 1_000_000 })
  })

  test('a timeout fails and keeps the in-flight mark', async () => {
    const h = harness([{ kind: 'timeout', ms: 4000 }, ok({ id: 'n1' })])
    const r = await writeFact(h.deps, fact)
    expect(r.status).toBe('failed')
    expect(h.mem.get(await factKey(fact))).toEqual({ state: 'in-flight', at: 1_000_000 })
  })

  test('after a timeout the next run within the TTL is skipped in-flight', async () => {
    const h = harness([{ kind: 'timeout', ms: 4000 }, ok({ id: 'n1' })])
    await writeFact(h.deps, fact)
    h.advance(IN_FLIGHT_TTL_MS - 1000)
    expect(await writeFact(h.deps, fact)).toEqual({ status: 'skipped', reason: 'in-flight' })
    expect(h.calls.length).toBe(1)
  })

  test('after a timeout a run past the TTL sends again', async () => {
    const h = harness([{ kind: 'timeout', ms: 4000 }, ok({ id: 'n1' })])
    await writeFact(h.deps, fact)
    h.advance(IN_FLIGHT_TTL_MS + 1)
    expect((await writeFact(h.deps, fact)).status).toBe('written')
    expect(h.calls.length).toBe(2)
  })

  test('a timeout on the live-head retry keeps the mark', async () => {
    const text = `The live row is ${HEAD}; retry with supersedes set to it`
    const h = harness([{ kind: 'tool_error', text, ms: 3 }, { kind: 'timeout', ms: 4000 }])
    expect((await writeFact(h.deps, fact)).status).toBe('failed')
    expect(h.mem.get(await factKey(fact))).toEqual({ state: 'in-flight', at: 1_000_000 })
  })

  test('an unreachable outcome clears the mark and the next attempt sends', async () => {
    const h = harness([{ kind: 'unreachable', error: 'refused', ms: 1 }, ok({ id: 'n1' })])
    expect((await writeFact(h.deps, fact)).status).toBe('failed')
    expect(h.mem.get(await factKey(fact)) ?? null).toBe(null)
    expect((await writeFact(h.deps, fact)).status).toBe('written')
    expect(h.calls.length).toBe(2)
  })

  test('a denied outcome clears the mark', async () => {
    const h = harness([{ kind: 'denied', error: 'not granted', ms: 1 }])
    expect(await writeFact(h.deps, fact)).toEqual({ status: 'failed', error: 'denied: not granted' })
    expect(h.mem.get(await factKey(fact)) ?? null).toBe(null)
  })

  test('an unreachable outcome reports its kind and text', async () => {
    const h = harness([{ kind: 'unreachable', error: 'refused', ms: 1 }])
    expect(await writeFact(h.deps, fact)).toEqual({ status: 'failed', error: 'unreachable: refused' })
    expect(h.mem.get(await factKey(fact)) ?? null).toBe(null)
  })
})
