import { describe, expect, test } from 'claude-code/testing'

import { callTool, classifyError, isOutage, parseResult } from '../src/mcp'
import type { McpDeps, RawResult } from '../src/mcp'

const text = (t: string): RawResult => ({ content: [{ type: 'text', text: t }], isError: false })

function deps(over: Partial<McpDeps>): McpDeps {
  let t = 0
  return {
    call: () => new Promise(() => {}),
    sleep: () => new Promise(() => {}),
    now: async () => (t += 5),
    ...over,
  }
}

describe('parseResult', () => {
  test('uses structuredContent when present', async () => {
    const r = parseResult({ content: [{ type: 'text', text: '# md' }], isError: false, structuredContent: { a: 1 } })
    expect(r.data).toEqual({ a: 1 })
    expect(r.text).toBe('# md')
    expect(r.isError).toBe(false)
  })

  test('parses a JSON text block, the shape Claude Code 2.1.287 returns', async () => {
    const r = parseResult(text('{"hits":[{"id":"1"}],"cached":true}'))
    expect(r.data).toEqual({ hits: [{ id: '1' }], cached: true })
    expect(r.text).toBe('{"hits":[{"id":"1"}],"cached":true}')
  })

  test('keeps a markdown text block as raw text', async () => {
    const r = parseResult(text('# Durable memory\n- a fact'))
    expect(r.data).toBe('# Durable memory\n- a fact')
    expect(r.text).toBe('# Durable memory\n- a fact')
  })

  test('an empty content list gives empty text', async () => {
    const r = parseResult({ content: [], isError: true })
    expect(r.text).toBe('')
    expect(r.isError).toBe(true)
  })

  test('skips non-text blocks to find the first text block', async () => {
    const r = parseResult({ content: [{ type: 'image' }, { type: 'text', text: '{"x":2}' }], isError: false })
    expect(r.data).toEqual({ x: 2 })
  })
})

describe('classifyError', () => {
  test('a permission refusal is denied', async () => {
    const msg = "Claude requested permissions to use mcp__lumberroom__memory_search, but you haven't granted it yet."
    expect(classifyError(new Error(msg))).toBe('denied')
    expect(classifyError(msg)).toBe('denied')
  })

  test('a connection error is unreachable', async () => {
    expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:8080'))).toBe('unreachable')
    expect(classifyError(undefined)).toBe('unreachable')
  })
})

describe('callTool', () => {
  test('returns timeout when sleep wins', async () => {
    const o = await callTool(deps({ sleep: async () => {} }), 's', 't', {}, 100)
    expect(o.kind).toBe('timeout')
    expect(isOutage(o)).toBe(true)
  })

  test('returns ok with parsed data when the call wins', async () => {
    const o = await callTool(deps({ call: async () => text('{"a":1}') }), 's', 't', {}, 100)
    expect(o.kind).toBe('ok')
    if (o.kind === 'ok') {
      expect(o.data).toEqual({ a: 1 })
      expect(o.text).toBe('{"a":1}')
      expect(o.ms).toBeGreaterThanOrEqual(0)
    }
    expect(isOutage(o)).toBe(false)
  })

  test('passes server, tool and args through', async () => {
    const seen: unknown[] = []
    await callTool(deps({ call: async (s, t, a) => (seen.push(s, t, a), text('{}')) }), 'srv', 'memory_search', { q: 'x' }, 100)
    expect(seen).toEqual(['srv', 'memory_search', { q: 'x' }])
  })

  test('returns tool_error on isError', async () => {
    const o = await callTool(deps({ call: async () => ({ content: [{ type: 'text', text: 'bad arg' }], isError: true }) }), 's', 't', {}, 100)
    expect(o.kind).toBe('tool_error')
    if (o.kind === 'tool_error') expect(o.text).toBe('bad arg')
    expect(isOutage(o)).toBe(false)
  })

  test('returns unreachable when the call rejects with a connection error', async () => {
    const o = await callTool(deps({ call: async () => { throw new Error('ECONNREFUSED') } }), 's', 't', {}, 100)
    expect(o.kind).toBe('unreachable')
    if (o.kind === 'unreachable') expect(o.error).toContain('ECONNREFUSED')
  })

  test('returns denied when the call rejects with a permission refusal', async () => {
    const o = await callTool(
      deps({ call: async () => { throw new Error("you haven't granted it yet.") } }), 's', 't', {}, 100)
    expect(o.kind).toBe('denied')
    expect(isOutage(o)).toBe(false)
  })

  test('a synchronous throw from call is an outcome, not an exception', async () => {
    const o = await callTool(deps({ call: () => { throw new Error('boom') } }), 's', 't', {}, 100)
    expect(o.kind).toBe('unreachable')
  })

  test('swallows a late rejection of the losing call', async () => {
    let rejectLate: (e: Error) => void = () => {}
    const late = new Promise<RawResult>((_, rej) => { rejectLate = rej })
    const unhandled: unknown[] = []
    const g = globalThis as unknown as { addEventListener?: (n: string, f: (e: unknown) => void) => void }
    g.addEventListener?.('unhandledrejection', (e) => unhandled.push(e))
    const o = await callTool(deps({ call: () => late, sleep: async () => {} }), 's', 't', {}, 100)
    expect(o.kind).toBe('timeout')
    rejectLate(new Error('late failure'))
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(unhandled).toEqual([])
  })
})

const NOT_CONNECTED_MSG =
  'no tool "context_bootstrap" on a server named "lumberroom"; servers with tools: claude_ai_Google_Drive, grafana'

describe('classifyError not_connected', () => {
  test('the not-connected-yet message Claude Code 2.1.287 throws at session start is not_connected', async () => {
    expect(classifyError(new Error(NOT_CONNECTED_MSG))).toBe('not_connected')
  })

  test('the older no-server spellings are not_connected too', async () => {
    expect(classifyError(new Error('No MCP server found with name: lumberroom'))).toBe('not_connected')
    expect(classifyError(new Error('no server named lumberroom'))).toBe('not_connected')
  })

  test('a permission refusal stays denied and a connection error stays unreachable', async () => {
    expect(classifyError(new Error("you haven't granted it yet."))).toBe('denied')
    expect(classifyError(new Error('connect ECONNREFUSED'))).toBe('unreachable')
  })

  test('callTool carries the message in a not_connected outcome that is no outage', async () => {
    const o = await callTool(deps({ call: async () => { throw new Error(NOT_CONNECTED_MSG) } }), 's', 't', {}, 100)
    expect(o.kind).toBe('not_connected')
    if (o.kind === 'not_connected') expect(o.error).toBe(NOT_CONNECTED_MSG)
    expect(isOutage(o)).toBe(false)
  })
})

describe('isOutage', () => {
  test('only timeout and unreachable count', async () => {
    expect(isOutage({ kind: 'timeout', ms: 1 })).toBe(true)
    expect(isOutage({ kind: 'unreachable', error: 'x', ms: 1 })).toBe(true)
    expect(isOutage({ kind: 'denied', error: 'x', ms: 1 })).toBe(false)
    expect(isOutage({ kind: 'not_connected', error: 'x', ms: 1 })).toBe(false)
    expect(isOutage({ kind: 'tool_error', text: 'x', ms: 1 })).toBe(false)
    expect(isOutage({ kind: 'ok', data: 1, text: '', ms: 1 })).toBe(false)
  })
})
