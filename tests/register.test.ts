import type { McpToolResult, On, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COMPACT_LINE } from '../hooks/register'
import { OLD_HOOK_OPENING, SECTION_ID } from '../src/digest'
import { GUARD_REASON } from '../src/guard'
import { DATA_NOTE, NUDGE_LINE, PERMISSION_TOAST, RECALL_CLOSE, RECALL_OPEN, REMINDER_CLOSE, REMINDER_OPEN, UNREACHABLE_TOAST } from '../src/recall'

const HOME = '/home/u'
const CWD = '/work/proj'
const NOW = 1_000_000

type Args = Record<string, unknown>
type Answer = (tool: string, args: Args, server?: string) => McpToolResult | Promise<McpToolResult>

const json = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })

const HIT = { id: 'm1', namespace: 'project:proj', content: 'Build with pnpm, never npm.', source: 'claude-code', occurred_at: '2026-09-01T00:00:00Z' }

/** The engine's tools, answering the shape spec 2.2 measured: the payload as JSON text. */
const engine: Answer = (tool) => {
  if (tool === 'context_bootstrap') return json({ text: '## Active project: proj\n- prefers pnpm', counts: { memories: 3 } })
  if (tool === 'memory_search') return json({ hits: [HIT] })
  return json({ id: 'w1' })
}

const missing: Answer = () => {
  throw new Error('No MCP server found with name: lumberroom')
}

interface Files {
  files?: Record<string, string>
  dirs?: Record<string, string[]>
  /** path -> names listed as sub-folders (kind `dir`). */
  folders?: Record<string, string[]>
  /** path -> realPath, answered by $.fs.stat with resolve. */
  real?: Record<string, string>
}

/**
 * Answers every `$` call the plugin makes beneath it. A test's `on` cannot register one event
 * twice, so each bottom hook reads a field of `w` that the test sets before it raises the event.
 */
function world(on: On, answer: Answer = engine, fs: Files = {}) {
  mock.env(on, { HOME })
  const clock = mock.clock(on, { now: NOW })

  const w = {
    clock,
    calls: [] as { tool: string; args: Args; server?: string }[],
    toasts: [] as string[],
    logs: [] as string[],
    commands: [] as string[],
    invalidated: [] as string[],
    statuses: [] as (string | undefined)[],
    /** The text core would report for a tool call the bottom hook answers. */
    toolText: undefined as string | undefined,
    fetched: [] as { url: string; method?: string; body?: string; headers?: Record<string, string> }[],
    modelPrompts: [] as string[],
    submitted: [] as { text: string; context?: readonly string[] }[],
    compacted: [] as { instructions?: string }[],
    state: {} as Record<string, unknown>,
    stored: {} as Record<string, unknown>,
    denyState: false,
    messages: [] as SessionMessage[],
    turns: 1,
    modelText: undefined as string | undefined,
    /** Answers a model call by its prompt; wins over modelText. */
    modelFor: undefined as ((prompt: string) => string) | undefined,
    modelHangs: false,
    httpHangs: false,
    cwd: CWD,
    compactSkip: false,
    baseSections: [] as { id: string; text: string; scope: 'shared' | 'session' }[],
    startContext: undefined as string[] | undefined,
    http: (() => ({ status: 200, text: '{}' })) as (url: string) => { status: number; text: string },
    /** What $.mcp.connect answers for the bundled key: a server name, or undefined for not connected. */
    connectAs: 'plugin:lumberroom-memory:lumberroom' as string | undefined,
  }
  const files = fs.files ?? {}
  const dirs = fs.dirs ?? {}

  // Not mock.store: the tests read what the plugin stored, and the kit's store hides it.
  on('store.get', (_$, e) => ({ value: w.stored[e.key] }))
  on('store.set', (_$, e) => {
    w.stored[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete w.stored[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(w.stored) }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.root', () => ({ value: w.cwd }))
  on('session.turns', () => ({ value: w.turns }))
  on('session.messages', () => ({ value: w.messages }))
  on('fs.exists', (_$, e) => ({ value: e.path === `${w.cwd}/.git` || e.path in files || e.path in dirs }))
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path] ?? '' } : { deny: `ENOENT ${e.path}` }))
  on('fs.stat', (_$, e) => {
    const realPath = fs.real?.[e.path]
    return realPath === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: true, realPath } }
  })
  on('fs.list', (_$, e) =>
    e.path in dirs || e.path in (fs.folders ?? {})
      ? {
          value: [
            ...(dirs[e.path] ?? []).map((name) => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
            ...(fs.folders?.[e.path] ?? []).map((name) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
          ],
        }
      : { deny: `ENOENT ${e.path}` },
  )
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', (_$, e) => {
    w.invalidated.push(e.event)
    return { value: undefined }
  })
  on('state.set', (_$, e, next) => {
    if (w.denyState) return { deny: 'state is down' }
    w.state[e.key] = e.value
    return next(e)
  })
  on('mcp.connect', () =>
    w.connectAs === undefined
      ? { value: { isConnected: false as const, reason: 'not-found' as never, message: 'not connected' } }
      : { value: { isConnected: true as const, server: w.connectAs } },
  )
  on('mcp.call', async (_$, e) => {
    w.calls.push({ tool: e.tool, args: e.args, server: e.server })
    // A hook that throws is skipped, so a call the engine rejects is simulated with a deny: its reason is the rejection.
    try {
      return { value: await answer(e.tool, e.args, e.server) }
    } catch (err) {
      return { deny: err instanceof Error ? err.message : String(err) }
    }
  })
  on('http.fetch', async (_$, e) => {
    const r = w.http(e.url)
    w.fetched.push({ url: e.url, method: e.init?.method, body: e.init?.body, headers: e.init?.headers })
    if (w.httpHangs) await new Promise<never>(() => {})
    return { value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text: r.text } }
  })
  on('model.complete', async (_$, e) => {
    w.modelPrompts.push(e.prompt)
    if (w.modelHangs) await new Promise<never>(() => {})
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    const text = w.modelFor === undefined ? w.modelText : w.modelFor(e.prompt)
    return {
      value: text === undefined ? { isAnswered: false as const, reason: 'empty-reply' as const, usage } : { isAnswered: true as const, text, usage },
    }
  })

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => {
    w.submitted.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  on('prompt.compose', () => ({ sections: w.baseSections }))
  on('prompt.section', (_$, e) => ({ text: e.text }))
  on('classic.SessionStart', () => (w.startContext === undefined ? {} : { additionalContext: w.startContext }))
  on('session.compact', (_$, e) => {
    w.compacted.push({ instructions: e.instructions })
    return w.compactSkip ? { skip: 'vetoed' } : { messages: TURNS }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => (w.toolText === undefined ? { result: 'ran' } : { result: 'ran', text: w.toolText }))
  on('tool.check', () => ({ decision: 'ask' as const }))
  return w
}

const START = { cwd: CWD, surface: null, isInteractive: false } as const
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const
const TURNS: SessionMessage[] = [
  { role: 'user', text: 'we ship on pnpm only', toolUses: [] },
  { role: 'assistant', text: 'noted, pnpm only', toolUses: [] },
]
const searches = <T extends { tool: string }>(w: { calls: T[] }) => w.calls.filter((c) => c.tool === 'memory_search')
const writes = <T extends { tool: string }>(w: { calls: T[] }) => w.calls.filter((c) => c.tool === 'memory_write')

/** Starts a session whose bootstrap may retry: each retry waits on the mock clock. */
const startRetrying = async ($: Engine, w: { clock: { settle: () => Promise<void>; advance: (ms: number) => Promise<void> } }, rounds = 12) => {
  const pending = $.session.start(START)
  for (let i = 0; i < rounds; i++) {
    await w.clock.settle()
    await w.clock.advance(500)
  }
  await pending
}

const NOT_CONNECTED_MSG =
  'no tool "context_bootstrap" on a server named "lumberroom"; servers with tools: claude_ai_Google_Drive, grafana'
const notConnected: Answer = () => {
  throw new Error(NOT_CONNECTED_MSG)
}
const NO_SERVER_TOAST = 'lumberroom-memory: no "plugin:lumberroom-memory:lumberroom" or "lumberroom" MCP server with memory tools is connected. Check /mcp, or the server option.'

type OriginKind = 'composer' | 'task-notification' | 'peer'
const send = ($: Engine, text: string, kind: OriginKind = 'composer') => $.prompt.submit({ text, wait: false, origin: { kind } })
const run = ($: Engine, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

describe('recall', () => {
  test('attaches a lumberroom-recall block with the engine hits, and never the same hit twice', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    await send($, 'how do I build this project?')
    const first = w.submitted[0]?.context ?? []
    expect(first.length).toBe(1)
    expect(first[0]).toMatch(RECALL_OPEN)
    expect(first[0]).toMatch(RECALL_CLOSE)
    expect(first[0]).toMatch('Build with pnpm, never npm.')
    expect(first[0]).toMatch('id m1')

    await send($, 'and how do I run the tests?')
    expect(w.submitted[1]?.context ?? []).toEqual([])

    expect(searches(w).length).toBe(2)
    expect(searches(w)[0]?.args).toEqual({ query: 'how do I build this project?', limit: 6, project: 'proj' })
  })

  test('recallExtraProjects widens the search to explicit namespaces at full weight', { options: { recall: true, recallExtraProjects: 'lumberroom, web' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(searches(w)[0]?.args).toEqual({
      query: 'how do I build this project?',
      limit: 6,
      project: 'proj',
      namespaces: ['user:me', 'global', 'project:proj', 'project:lumberroom', 'project:web'],
    })
  })

  test('project=extras entries apply in the matching project', { options: { recall: true, recallExtraProjects: 'proj=lumberroom+web, other=zzz' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(searches(w)[0]?.args).toEqual({
      query: 'how do I build this project?',
      limit: 6,
      project: 'proj',
      namespaces: ['user:me', 'global', 'project:proj', 'project:lumberroom', 'project:web'],
    })
  })

  test('project=extras entries for another project leave the call unchanged', { options: { recall: true, recallExtraProjects: 'other=lumberroom' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(searches(w)[0]?.args).toEqual({ query: 'how do I build this project?', limit: 6, project: 'proj' })
  })

  test('bare and project entries combine in the matching project', { options: { recall: true, recallExtraProjects: 'shared, proj=lumberroom' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(searches(w)[0]?.args).toEqual({
      query: 'how do I build this project?',
      limit: 6,
      project: 'proj',
      namespaces: ['user:me', 'global', 'project:proj', 'project:shared', 'project:lumberroom'],
    })
  })

  test('recallExtraProjects drops the current project and keeps the call otherwise unchanged', { options: { recall: true, recallExtraProjects: 'proj' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(searches(w)[0]?.args).toEqual({ query: 'how do I build this project?', limit: 6, project: 'proj' })
  })

  test('recallExtraProjects with project none searches user, global and the extras', { options: { recall: true, project: 'none', recallExtraProjects: 'lumberroom, proj=web' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(searches(w)[0]?.args).toEqual({
      query: 'how do I build this project?',
      limit: 6,
      namespaces: ['user:me', 'global', 'project:lumberroom'],
    })
  })

  test('keeps the context a hook above already attached', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'where is the config?')
    expect((w.submitted[0]?.context ?? []).length).toBe(1)
  })

  test('a slash command and an empty prompt make no call', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const before = w.calls.length

    await send($, '/help')
    await send($, '   ')

    expect(w.calls.length).toBe(before)
    expect(w.submitted.map((s) => s.context ?? [])).toEqual([[], []])
  })

  test('a prompt from a task notification gets no recall', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'build finished', 'task-notification')
    expect(searches(w)).toEqual([])
  })

  test('recall off sends the prompt through with no search', { options: { recall: false } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'where do the logs go?')
    expect(searches(w)).toEqual([])
    expect(w.submitted[0]?.context ?? []).toEqual([])
  })

  test('a hung memory_search past recallTimeoutMs lets the prompt through with no context', { options: { recall: true } }, async ($, on) => {
    const hang: Answer = (tool, args) => (tool === 'memory_search' ? new Promise<McpToolResult>(() => {}) : engine(tool, args))
    const w = world(on, hang)
    await $.session.start(START)

    const pending = send($, 'where is the config?')
    await w.clock.settle()
    await w.clock.advance(2500)
    const result = await pending

    expect(result.text).toBe('where is the config?')
    expect(w.submitted[0]?.context ?? []).toEqual([])
    expect(w.toasts).toEqual([UNREACHABLE_TOAST])
  })

  test('three outages open the breaker and the fourth prompt makes no call, with one toast for the outage', { options: { recall: true } }, async ($, on) => {
    const down: Answer = (tool, args) => {
      if (tool === 'memory_search') throw new Error('connect ECONNREFUSED')
      return engine(tool, args)
    }
    const w = world(on, down)
    await $.session.start(START)

    for (const text of ['question number one', 'question number two', 'question number three', 'question number four']) await send($, text)

    expect(searches(w).length).toBe(3)
    expect(w.submitted.length).toBe(4)
    expect(w.submitted.every((s) => (s.context ?? []).length === 0)).toBe(true)
    expect(w.toasts).toEqual([UNREACHABLE_TOAST])
  })

  test('the breaker closes after its cooldown and the next prompt searches again', { options: { recall: true } }, async ($, on) => {
    let up = false
    const flaky: Answer = (tool, args) => {
      if (tool === 'memory_search' && !up) throw new Error('connect ECONNREFUSED')
      return engine(tool, args)
    }
    const w = world(on, flaky)
    await $.session.start(START)
    for (const text of ['first of the batch', 'second of the batch', 'third of the batch', 'fourth of the batch']) await send($, text)
    expect(searches(w).length).toBe(3)

    up = true
    await w.clock.advance(61_000)
    await send($, 'fifth of the batch')
    expect(searches(w).length).toBe(4)
    expect((w.submitted[4]?.context ?? [])[0]).toMatch('Build with pnpm')
  })

  test('the write nudge rides every reviewInterval prompts even with no new hits', { options: { recall: true, reviewInterval: 2 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'first question')
    await send($, 'second question')

    expect((w.submitted[0]?.context ?? [])[0]).not.toMatch(NUDGE_LINE)
    const second = (w.submitted[1]?.context ?? [])[0] ?? ''
    expect(second).toMatch(NUDGE_LINE)
    expect(second).not.toMatch('id m1')
  })

  test('a failed session start bootstrap is retried by the next prompt', { options: { recall: true } }, async ($, on) => {
    let boots = 0
    const late: Answer = (tool, args) => {
      if (tool === 'context_bootstrap') {
        boots += 1
        if (boots === 1) throw new Error('connect ECONNREFUSED')
      }
      return engine(tool, args)
    }
    const w = world(on, late)
    await $.session.start(START)
    await send($, 'where is the config?')
    await send($, 'and the logs?')

    expect(boots).toBe(2)
    expect(searches(w).length).toBe(2)
    expect((await $.prompt.compose(COMPOSE)).sections.some((s) => s.id === SECTION_ID && s.text.includes('prefers pnpm'))).toBe(true)
  })

  test('not-connected prompts skip recall with no toast until the third, which toasts once and stops the calls', async ($, on) => {
    const w = world(on, notConnected)
    await startRetrying($, w, 20)
    const atStart = w.calls.length

    await send($, 'first question')
    await send($, 'second question')
    expect(w.toasts).toEqual([])
    await send($, 'third question')
    expect(w.toasts).toEqual([NO_SERVER_TOAST])

    const atStop = w.calls.length
    // Each prompt tries both candidates.
    expect(atStop).toBe(atStart + 6)
    await send($, 'fourth question')
    await send($, 'fifth question')
    expect(w.calls.length).toBe(atStop)
    expect(w.toasts).toEqual([NO_SERVER_TOAST])
    expect(w.submitted.every((s) => (s.context ?? []).length === 0)).toBe(true)
  })

  test('a memory_search that answers not-connected counts the same way, with no breaker failure', { options: { recall: true } }, async ($, on) => {
    const gone: Answer = (tool, args) => {
      if (tool === 'memory_search') throw new Error(NOT_CONNECTED_MSG)
      return engine(tool, args)
    }
    const w = world(on, gone)
    await $.session.start(START)
    for (const text of ['question number one', 'question number two']) await send($, text)
    expect(w.toasts).toEqual([])
    await send($, 'question number three')
    expect(w.toasts).toEqual([NO_SERVER_TOAST])
    await send($, 'question number four')
    expect(searches(w).length).toBe(3)
    expect(w.state['breaker']).toBeUndefined()
  })

  test('the stop lasts until the next session start', { options: { recall: true } }, async ($, on) => {
    let up = false
    const flaky: Answer = (tool, args) => {
      if (!up) throw new Error(NOT_CONNECTED_MSG)
      return engine(tool, args)
    }
    const w = world(on, flaky)
    await startRetrying($, w, 20)
    for (const text of ['first of the batch', 'second of the batch', 'third of the batch']) await send($, text)
    expect(w.toasts.length).toBe(1)

    up = true
    await send($, 'fourth of the batch')
    expect(searches(w).length).toBe(0)

    await startRetrying($, w, 2)
    await send($, 'fifth of the batch')
    expect(searches(w).length).toBe(1)
    expect((w.submitted[4]?.context ?? [])[0]).toMatch('Build with pnpm')
  })

  test('records the last recall and the stats in state', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')

    const last = w.state.lastRecall as { query: string; hits: { id: string }[]; returned: number }
    expect(last.query).toBe('how do I build this project?')
    expect(last.hits.map((h) => h.id)).toEqual(['m1'])
    expect(last.returned).toBe(1)
    expect(w.state.seen).toEqual(['m1'])
    expect(w.state.prompts).toBe(1)
    expect(w.state.stats).toMatchObject({ recalls: 1, hitsAttached: 1, offline: false })
  })

  test('a state failure inside the hook logs and the prompt still goes through', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.denyState = true
    const out = await send($, 'where is the config?')

    expect(out.text).toBe('where is the config?')
    expect(w.submitted.length).toBe(1)
    expect(w.logs.length).toBeGreaterThan(0)
  })
})

describe('recall relevance and the nudge', () => {
  const ranked: Answer = (tool, args) => {
    if (tool === 'memory_search') {
      return json({
        hits: [
          { ...HIT, id: 'low1', content: 'unrelated one', similarity: 0.49 },
          { ...HIT, id: 'low2', content: 'unrelated two', similarity: 0.52 },
          { ...HIT, id: 'good', content: 'Deploys go through the release script.', similarity: 0.74 },
        ],
      })
    }
    return engine(tool, args)
  }

  test('drops hits below recallMinSimilarity and attaches the rest', { options: { recall: true } }, async ($, on) => {
    const w = world(on, ranked)
    await $.session.start(START)
    await send($, 'how do we deploy this service?')

    const block = (w.submitted[0]?.context ?? [])[0] ?? ''
    expect(block).toMatch('Deploys go through the release script.')
    expect(block).not.toMatch('unrelated')
    expect(w.state.seen).toEqual(['good'])
    expect((w.state.lastRecall as { returned: number }).returned).toBe(3)
  })

  test('attaches nothing when every hit is under the floor, and the floor is an option', { options: { recall: true } }, async ($, on) => {
    const w = world(on, (tool, args) => (tool === 'memory_search' ? json({ hits: [{ ...HIT, id: 'low1', similarity: 0.5 }] }) : engine(tool, args)))
    await $.session.start(START)
    await send($, 'enabled hot-reloading!')
    expect(w.submitted[0]?.context ?? []).toEqual([])
    expect(w.state.seen ?? []).toEqual([])
  })

  test('a lower recallMinSimilarity lets the same hits through', { options: { recall: true, recallMinSimilarity: 0.4 } }, async ($, on) => {
    const w = world(on, ranked)
    await $.session.start(START)
    await send($, 'how do we deploy this service?')
    expect(w.state.seen).toEqual(['low1', 'low2', 'good'])
  })

  test('a prompt under 12 characters makes no search', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'ok thanks')
    expect(searches(w)).toEqual([])
    expect(w.submitted[0]?.context ?? []).toEqual([])
  })

  test('the nudge fires on its interval when the search timed out, with the data note', { options: { recall: true, reviewInterval: 2 } }, async ($, on) => {
    let hang = false
    const answer: Answer = (tool, args) => (tool === 'memory_search' && hang ? new Promise<McpToolResult>(() => {}) : engine(tool, args))
    const w = world(on, answer)
    await $.session.start(START)
    await send($, 'first question here')
    hang = true
    const pending = send($, 'second question here')
    await w.clock.settle()
    await w.clock.advance(2500)
    await pending

    const second = (w.submitted[1]?.context ?? [])[0] ?? ''
    expect(second).toMatch(NUDGE_LINE)
    expect(second).toMatch(DATA_NOTE)
    expect(second).not.toMatch('id m1')
  })

  test('the nudge fires on its interval when the search errored', { options: { recall: true, reviewInterval: 1 } }, async ($, on) => {
    const w = world(on, (tool, args) => {
      if (tool === 'memory_search') throw new Error('connect ECONNREFUSED')
      return engine(tool, args)
    })
    await $.session.start(START)
    await send($, 'first question here')
    expect((w.submitted[0]?.context ?? [])[0]).toMatch(NUDGE_LINE)
  })
})

describe('the reminder with recall off', () => {
  const reminderOf = (w: { submitted: { context?: readonly string[] }[] }, i: number): string => (w.submitted[i]?.context ?? [])[0] ?? ''

  test('recall is off with no options: no search, no context on a plain prompt', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(searches(w)).toEqual([])
    expect(w.submitted[0]?.context ?? []).toEqual([])
  })

  test('the default interval of 8 sends the reminder on the eighth prompt only', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    for (let i = 1; i <= 9; i++) await send($, `question number ${i} here`)
    const carriers = w.submitted.map((s, i) => (reminderOf(w, i) === '' ? -1 : i + 1)).filter((n) => n > 0)
    expect(carriers).toEqual([8])
  })

  test('the reminder rides its own wrapper, without the data note or the recall tags', { options: { reviewInterval: 2 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'first question here')
    await send($, 'second question here')
    expect(reminderOf(w, 0)).toBe('')
    const block = reminderOf(w, 1)
    expect(block.startsWith(REMINDER_OPEN)).toBe(true)
    expect(block.endsWith(REMINDER_CLOSE)).toBe(true)
    expect(block).toContain(NUDGE_LINE)
    expect(block).not.toContain(DATA_NOTE)
    expect(block).not.toContain(RECALL_OPEN)
    expect(searches(w)).toEqual([])
  })

  test('a short prompt from the person counts toward the interval', { options: { reviewInterval: 2 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'ok')
    await send($, 'yes')
    expect(reminderOf(w, 1)).toContain(NUDGE_LINE)
  })

  test('a slash command and a task notification do not count', { options: { reviewInterval: 2 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'first question here')
    await send($, '/help')
    await send($, 'build finished', 'task-notification')
    await send($, 'second question here')
    expect(w.submitted.map((_, i) => reminderOf(w, i) !== '')).toEqual([false, false, false, true])
  })

  test('reviewInterval 0 sends no reminder', { options: { reviewInterval: 0 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    for (let i = 1; i <= 10; i++) await send($, `question number ${i} here`)
    expect(w.submitted.every((s) => (s.context ?? []).length === 0)).toBe(true)
  })

  test('a server that is not connected gets no reminder', { options: { reviewInterval: 1 } }, async ($, on) => {
    const w = world(on, notConnected)
    await startRetrying($, w, 20)
    await send($, 'first question here')
    expect(reminderOf(w, 0)).toBe('')
  })

  test('with recall on, a short prompt that falls due carries the reminder wrapper and no search', { options: { recall: true, reviewInterval: 1 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'ok')
    expect(searches(w)).toEqual([])
    expect(reminderOf(w, 0).startsWith(REMINDER_OPEN)).toBe(true)
  })

  test('the counter restarts after /clear', { options: { reviewInterval: 2 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'first question here')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
    await send($, 'second question here')
    expect(reminderOf(w, 1)).toBe('')
  })
})

describe('bootstrap with recall off', () => {
  test('a server that was late at start gets its digest on the first prompt', { options: { recall: false } }, async ($, on) => {
    let boots = 0
    const late: Answer = (tool, args) => {
      if (tool === 'context_bootstrap' && (boots += 1) === 1) throw new Error('connect ECONNREFUSED')
      return engine(tool, args)
    }
    const w = world(on, late)
    await $.session.start(START)
    expect((await $.prompt.compose(COMPOSE)).sections.some((s) => s.text.includes('prefers pnpm'))).toBe(false)

    await send($, 'where do the logs go?')

    expect(boots).toBe(2)
    expect(searches(w)).toEqual([])
    expect((await $.prompt.compose(COMPOSE)).sections.some((s) => s.id === SECTION_ID && s.text.includes('prefers pnpm'))).toBe(true)
  })
})

describe('bootstrap', () => {
  test('context_bootstrap gets the git root slug as project', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.calls[0]).toMatchObject({ tool: 'context_bootstrap', args: { project: 'proj' } })
    expect(w.state.digest).toMatchObject({ project: 'proj', text: '## Active project: proj\n- prefers pnpm', memories: 3 })
  })

  test('project none sends no project argument', { options: { project: 'none' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.calls[0]).toMatchObject({ tool: 'context_bootstrap', args: {} })
  })

  test('registers the lr-import command', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toEqual(['lr-import'])
  })

  test('a server that connects after a few not-connected answers stores the digest with no toast', { options: { recall: true } }, async ($, on) => {
    let boots = 0
    const connecting: Answer = (tool, args) => {
      if (tool === 'context_bootstrap' && (boots += 1) <= 3) throw new Error(NOT_CONNECTED_MSG)
      return engine(tool, args)
    }
    const w = world(on, connecting)
    await startRetrying($, w)

    expect(boots).toBe(4)
    expect(w.toasts).toEqual([])
    expect((await $.prompt.compose(COMPOSE)).sections.some((s) => s.id === SECTION_ID && s.text.includes('prefers pnpm'))).toBe(true)
    await send($, 'where is the config?')
    expect(searches(w).length).toBe(1)
  })

  test('start gives up retrying after bootstrapTimeoutMs in total, with no toast, and a prompt retries', async ($, on) => {
    const w = world(on, notConnected)
    await startRetrying($, w, 20)
    const atStart = w.calls.length

    expect(atStart).toBeGreaterThan(2)
    // 4000 ms of waiting in 500 ms steps: the loop cannot run on past the budget.
    // Two candidates per attempt.
    expect(atStart).toBeLessThanOrEqual(20)
    expect(w.toasts).toEqual([])

    await send($, 'where is the config?')
    expect(w.calls.length).toBe(atStart + 2)
    expect(w.calls.every((c) => c.tool === 'context_bootstrap')).toBe(true)
    expect(w.toasts).toEqual([])
  })

  test('a bootstrap timeout at start still toasts the outage and does not retry', async ($, on) => {
    const hang: Answer = (tool, args) => (tool === 'context_bootstrap' ? new Promise<McpToolResult>(() => {}) : engine(tool, args))
    const w = world(on, hang)
    const pending = $.session.start(START)
    await w.clock.settle()
    await w.clock.advance(4500)
    await pending

    expect(w.calls.length).toBe(1)
    expect(w.toasts).toEqual([UNREACHABLE_TOAST])
  })

  test('an ECONNREFUSED bootstrap at start is no retry loop and counts as an outage', async ($, on) => {
    const down: Answer = () => {
      throw new Error('connect ECONNREFUSED')
    }
    const w = world(on, down)
    await $.session.start(START)

    expect(w.calls.length).toBe(1)
    expect(w.toasts).toEqual([UNREACHABLE_TOAST])
  })
})

describe('prompt.compose', () => {
  test('adds the lumberroom section once with the digest and the write rule', async ($, on) => {
    world(on)
    await $.session.start(START)

    const first = await $.prompt.compose(COMPOSE)
    const again = await $.prompt.compose(COMPOSE)

    for (const out of [first, again]) {
      const ours = out.sections.filter((s) => s.id === SECTION_ID)
      expect(ours.length).toBe(1)
      expect(ours[0]?.scope).toBe('session')
      expect(ours[0]?.text).toMatch('prefers pnpm')
      expect(ours[0]?.text).toMatch('memory_write')
    }
  })

  test('leaves a list alone that already holds the section', async ($, on) => {
    const w = world(on)
    w.baseSections = [{ id: SECTION_ID, text: 'already here', scope: 'session' }]
    await $.session.start(START)
    const out = await $.prompt.compose(COMPOSE)
    expect(out.sections.map((s) => s.text)).toEqual(['already here'])
  })

  test('puts its own section after the sections beneath it', async ($, on) => {
    const w = world(on)
    w.baseSections = [{ id: 'intro', text: 'hello', scope: 'shared' }]
    await $.session.start(START)
    const out = await $.prompt.compose(COMPOSE)
    expect(out.sections.map((s) => s.id)).toEqual(['intro', SECTION_ID])
  })

  test('drops the write rule when CLAUDE.md already carries it', async ($, on) => {
    world(on, engine, { files: { [`${HOME}/.claude/CLAUDE.md`]: '# Durable memory\n\nCall memory_write after every decision.\n' } })
    await $.session.start(START)
    const out = await $.prompt.compose(COMPOSE)
    const ours = out.sections.find((s) => s.id === SECTION_ID)
    expect(ours?.text).toMatch('prefers pnpm')
    expect(ours?.text).not.toMatch('Two facts from one exchange are two calls.')
  })

  test('keeps the write rule when the project CLAUDE.md has no such block', async ($, on) => {
    world(on, engine, { files: { [`${CWD}/CLAUDE.md`]: '# Project\n\nRun the tests.\n' } })
    await $.session.start(START)
    const out = await $.prompt.compose(COMPOSE)
    expect(out.sections.find((s) => s.id === SECTION_ID)?.text).toMatch('Two facts from one exchange are two calls.')
  })

  test('adds no section while the server is not connected', async ($, on) => {
    const w = world(on, missing)
    await startRetrying($, w, 20)
    const out = await $.prompt.compose(COMPOSE)
    expect(out.sections.some((s) => s.id === SECTION_ID)).toBe(false)
  })
})

describe('prompt.section', () => {
  test('the built-in memory section answers null', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await $.prompt.section({ name: 'memory', text: '# memory\nstuff' })).toEqual({ text: null })
  })

  test('another section passes through', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await $.prompt.section({ name: 'env_info_simple', text: 'env' })).toEqual({ text: 'env' })
  })

  test('replaceBuiltinMemory off keeps the memory section', { options: { replaceBuiltinMemory: false } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await $.prompt.section({ name: 'memory', text: '# memory\nstuff' })).toEqual({ text: '# memory\nstuff' })
  })
})

describe('tool guard', () => {
  test('denies a Write under the built-in memory folder', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Write', file_path: `${HOME}/.claude/projects/x/memory/a.md`, content: 'x' })
    expect(out.deny).toBe(GUARD_REASON)
  })

  test('lets a Write elsewhere through', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Write', file_path: `${CWD}/notes.md`, content: 'x' })
    expect(out.deny).toBeUndefined()
    expect(out.result).toBe('ran')
  })

  test('denies a spelling with .. that lands in the memory folder', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Edit', file_path: `${CWD}/../../home/u/.claude/projects/x/memory/../memory/a.md`, old_string: 'a', new_string: 'b' })
    expect(out.deny).toBe(GUARD_REASON)
  })

  test('denies a path outside the folder whose real path is inside it', async ($, on) => {
    const link = `${CWD}/link.md`
    world(on, engine, { real: { [link]: `${HOME}/.claude/projects/x/memory/a.md` } })
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Read', file_path: link })
    expect(out.deny).toBe(GUARD_REASON)
  })

  test('denies a MEMORY.md under the claude folder', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Read', file_path: `${HOME}/.claude/MEMORY.md` })
    expect(out.deny).toBe(GUARD_REASON)
  })

  test('denies a new file whose parent folder is a link into the memory folder', async ($, on) => {
    const linkDir = `${CWD}/linked`
    world(on, engine, { real: { [linkDir]: `${HOME}/.claude/projects/x/memory` } })
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Write', file_path: `${linkDir}/new.md`, content: 'x' })
    expect(out.deny).toBe(GUARD_REASON)
  })

  test('lets a new file through when its parent resolves outside the memory folder', async ($, on) => {
    const dir = `${CWD}/docs`
    world(on, engine, { real: { [dir]: `${CWD}/docs` } })
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Write', file_path: `${dir}/new.md`, content: 'x' })
    expect(out.deny).toBeUndefined()
  })

  test('lets a MEMORY.md elsewhere under .claude through', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Read', file_path: `${HOME}/.claude/plugins/p/MEMORY.md` })
    expect(out.deny).toBeUndefined()
  })

  for (const tool of ['Grep', 'Glob']) {
    test(`denies ${tool} whose path is the memory folder`, async ($, on) => {
      world(on)
      await $.session.start(START)
      const out = await $.tool.call({ tool, pattern: 'pnpm', path: `${HOME}/.claude/projects/x/memory` } as never)
      expect(out.deny).toBe(GUARD_REASON)
    })

    test(`denies ${tool} whose path is a link into the memory folder`, async ($, on) => {
      const link = `${CWD}/mem`
      world(on, engine, { real: { [link]: `${HOME}/.claude/projects/x/memory` } })
      await $.session.start(START)
      const out = await $.tool.call({ tool, pattern: 'pnpm', path: link } as never)
      expect(out.deny).toBe(GUARD_REASON)
    })

    test(`lets ${tool} through on another path and with no path`, async ($, on) => {
      world(on)
      await $.session.start(START)
      expect((await $.tool.call({ tool, pattern: 'pnpm', path: `${CWD}/src` } as never)).deny).toBeUndefined()
      expect((await $.tool.call({ tool, pattern: 'pnpm' } as never)).deny).toBeUndefined()
    })
  }

  test('replaceBuiltinMemory off lets the memory folder through', { options: { replaceBuiltinMemory: false } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Write', file_path: `${HOME}/.claude/projects/x/memory/a.md`, content: 'x' })
    expect(out.deny).toBeUndefined()
  })

  test('a tool the guard does not cover is never refused', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.call({ tool: 'Bash', command: `cat ${HOME}/.claude/projects/x/memory/a.md` })
    expect(out.deny).toBeUndefined()
  })
})

describe('tool.check', () => {
  test('passes a call from the engine on to the rules beneath', async ($, on) => {
    world(on)
    await $.session.start(START)
    const out = await $.tool.check({ tool: 'mcp__lumberroom__memory_search', input: {} })
    expect(out.decision).toBe('ask')
  })

  test(
    'does not allow another plugin the same tools',
    {
      plugins: [
        {
          name: 'other',
          register(on) {
            on('command.run', { command: 'other' }, async ($) => {
              const v = await $.tool.check({ tool: 'mcp__lumberroom__memory_write', input: {} })
              return { text: v.decision }
            })
          },
        },
      ],
    },
    async ($, on) => {
      world(on)
      await $.session.start(START)
      expect((await run($, 'other')).text).toBe('ask')
    },
  )
})

describe('classic.SessionStart', () => {
  test('cuts the old shell hook block and keeps other entries', async ($, on) => {
    const w = world(on)
    const old = `${OLD_HOOK_OPENING}\n\n- a fact\n- another fact\n_(showing 2 of 9; use memory_search for the rest)_`
    w.startContext = [old, 'Project note: keep tests green.']
    await $.session.start(START)
    const out = await $.classic.SessionStart({ source: 'startup' })
    expect(out.additionalContext).toEqual(['Project note: keep tests green.'])
  })

  test('passes text through when the opening line is absent', async ($, on) => {
    const w = world(on)
    w.startContext = ['Some other hook said hello.']
    await $.session.start(START)
    const out = await $.classic.SessionStart({ source: 'startup' })
    expect(out.additionalContext).toEqual(['Some other hook said hello.'])
  })

  test('keeps the old block when the server is missing, so no context is lost', async ($, on) => {
    const w = world(on, missing)
    const old = `${OLD_HOOK_OPENING}\n\n- a fact`
    w.startContext = [old]
    await startRetrying($, w, 20)
    const out = await $.classic.SessionStart({ source: 'startup' })
    expect(out.additionalContext).toEqual([old])
  })
})

describe('dedup lifetime', () => {
  const END = (reason: string) => ({ reason, sessionId: 's1', resume: { id: 's1' } }) as never

  test('/clear resets the seen ids and the prompt count, so a hit can attach again', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(w.state.seen).toEqual(['m1'])
    expect(w.state.prompts).toBe(1)

    await $.session.end(END('clear'))
    expect(w.state.seen).toEqual([])
    expect(w.state.prompts).toBe(0)

    await send($, 'how do I build this project?')
    expect((w.submitted[1]?.context ?? [])[0]).toMatch('id m1')
  })

  test('another end reason keeps the dedup state', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    await $.session.end(END('other'))
    expect(w.state.seen).toEqual(['m1'])
    expect(w.state.prompts).toBe(1)
  })

  test('a finished compaction resets the seen ids and the prompt count', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    await $.session.compact({ trigger: 'manual', messages: TURNS })
    expect(w.state.seen).toEqual([])
    expect(w.state.prompts).toBe(0)

    await send($, 'how do I build this project?')
    expect((w.submitted[1]?.context ?? [])[0]).toMatch('id m1')
  })

  test('a precompute and a vetoed compaction keep the dedup state', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    await $.session.compact({ trigger: 'precompute', messages: TURNS })
    expect(w.state.seen).toEqual(['m1'])
    w.compactSkip = true
    await $.session.compact({ trigger: 'manual', messages: TURNS })
    expect(w.state.seen).toEqual(['m1'])
    expect(w.state.prompts).toBe(1)
  })
})

describe('classic.SessionStart before the digest is stored', () => {
  const old = `${OLD_HOOK_OPENING}\n\n- a fact\n- another fact`

  test('keeps the old block when the bootstrap failed with an outage', async ($, on) => {
    const w = world(on, () => {
      throw new Error('connect ECONNREFUSED')
    })
    w.startContext = [old]
    await $.session.start(START)
    const out = await $.classic.SessionStart({ source: 'startup' })
    expect(out.additionalContext).toEqual([old])
  })

  test('keeps the old block when the hook runs before session.start has fetched the digest', async ($, on) => {
    const w = world(on)
    w.startContext = [old]
    const out = await $.classic.SessionStart({ source: 'startup' })
    expect(out.additionalContext).toEqual([old])
  })

  const CACHED = { project: 'proj', text: '## Active project: proj\n- cached fact', memories: 3, fetchedAt: 1 }

  test('cuts the old block before session.start when an earlier session cached the digest', async ($, on) => {
    const w = world(on)
    w.stored['digest-cache:proj'] = CACHED
    w.startContext = [old]
    const out = await $.classic.SessionStart({ source: 'startup' })
    expect(out.additionalContext).toEqual([])
  })

  test('a successful bootstrap caches the digest for the next session', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect((w.stored['digest-cache:proj'] as { text?: string } | undefined)?.text).toMatch('prefers pnpm')
  })

  test('a failed bootstrap falls back to the cached digest in the section', async ($, on) => {
    const w = world(on, () => {
      throw new Error('connect ECONNREFUSED')
    })
    w.stored['digest-cache:proj'] = CACHED
    await $.session.start(START)
    expect((await $.prompt.compose(COMPOSE)).sections.some((s) => s.id === SECTION_ID && s.text.includes('cached fact'))).toBe(true)
  })

  test('with no server connected, the cached digest fills the section', async ($, on) => {
    const w = world(on, notConnected)
    w.connectAs = undefined
    w.stored['digest-cache:proj'] = CACHED
    await startRetrying($, w, 20)
    expect((await $.prompt.compose(COMPOSE)).sections.some((s) => s.id === SECTION_ID && s.text.includes('cached fact'))).toBe(true)
  })

  test('cuts the old block once the digest is stored', async ($, on) => {
    const w = world(on)
    w.startContext = [old]
    await $.session.start(START)
    const out = await $.classic.SessionStart({ source: 'startup' })
    expect(out.additionalContext).toEqual([])
  })
})

describe('session.compact', () => {
  test('appends the keep-facts line to the instructions', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.session.compact({ trigger: 'manual', instructions: 'focus on the parser', messages: TURNS })
    const sent = w.compacted[0]?.instructions ?? ''
    expect(sent).toMatch('focus on the parser')
    expect(sent.endsWith(COMPACT_LINE)).toBe(true)
  })

  test('sets the line alone when there were no instructions', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.session.compact({ trigger: 'auto', messages: TURNS })
    expect(w.compacted[0]?.instructions).toBe(COMPACT_LINE)
  })
})

describe('server choice', () => {
  test('auto uses the bundled server when it answers', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(w.calls.map((c) => c.server)).toEqual(['plugin:lumberroom-memory:lumberroom', 'plugin:lumberroom-memory:lumberroom'])
  })

  test('auto follows the name $.mcp.connect answers, such as a claude.ai connector running the same server', { options: { recall: true } }, async ($, on) => {
    const w = world(on)
    w.connectAs = 'claude.ai Lumberroom'
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(w.calls.map((c) => c.server)).toEqual(['claude.ai Lumberroom', 'claude.ai Lumberroom'])
  })

  test('auto falls back to a registered lumberroom when the bundled server is suppressed', { options: { recall: true } }, async ($, on) => {
    const w = world(on, (tool, args, server) => {
      if (server !== 'lumberroom') throw new Error(`no tool "${tool}" on a server named "${server}"; servers with tools: lumberroom`)
      return engine(tool, args)
    })
    w.connectAs = undefined
    await $.session.start(START)
    await send($, 'how do I build this project?')
    expect(w.calls.map((c) => c.server)).toEqual(['plugin:lumberroom-memory:lumberroom', 'lumberroom', 'lumberroom'])
    expect((w.submitted[0]?.context ?? [])[0]).toMatch('Build with pnpm')
  })

})

describe('permission refusal', () => {
  test('a refused call toasts the permissions page once a session, and the breaker stays closed', { options: { recall: true } }, async ($, on) => {
    const w = world(on, (tool, _args, server) => {
      throw new Error(`lumberroom-memory: $.mcp.call(${server}, ${tool}) refused: The server-side auto mode classifier gave no verdict`)
    })
    await $.session.start(START)
    await send($, 'how do I build this project?')
    await send($, 'and how do I run the tests?')
    expect(w.toasts).toEqual([PERMISSION_TOAST])
    expect(w.state['breaker']).toBeUndefined()
  })
})

describe('token status line', () => {
  const last = (w: { statuses: (string | undefined)[] }) => w.statuses[w.statuses.length - 1] ?? ''

  test('counts the section, the reminder blocks and the model\'s lumberroom results', { options: { reviewInterval: 1 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const section = (await $.prompt.compose(COMPOSE)).sections.find((s) => s.id === SECTION_ID)?.text ?? ''
    expect(last(w)).toMatch(`digest ${Math.ceil(section.length / 4)},`)

    await send($, 'what did we decide about the build?')
    const block = w.submitted[0]?.context?.[0] ?? ''
    expect(last(w)).toMatch(`reminders ${Math.ceil(block.length / 4)},`)

    w.toolText = 'x'.repeat(400)
    await $.tool.call({ tool: 'mcp__lumberroom__memory_search', query: 'build' })
    expect(last(w)).toMatch('tools 100 (1 call)')

    await $.tool.call({ tool: 'Read', file_path: `${CWD}/a.md` })
    expect(last(w)).toMatch('tools 100 (1 call)')
  })

  test('session start draws the line before any prompt', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(last(w)).toMatch(/^lumberroom ~\d+ tokens in context: digest [1-9]/)
  })

  test('compaction clears the transcript parts and keeps the digest', { options: { reviewInterval: 1 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.prompt.compose(COMPOSE)
    await send($, 'what did we decide about the build?')
    w.toolText = 'x'.repeat(400)
    await $.tool.call({ tool: 'mcp__lumberroom__memory_search', query: 'build' })
    await $.session.compact({ trigger: 'manual', messages: TURNS })
    expect(last(w)).toMatch(', reminders 0, tools 0 (0 calls)')
    expect(last(w)).not.toMatch('digest 0,')
  })
})

const FACT_LINE = JSON.stringify({ content: 'The project ships with pnpm only.', namespace: 'project:proj', tags: [] })
const DONE = { answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const
const TURN_MODE = { extractor: 'turn', reviewInterval: 1 } as const

describe('extractor', () => {
  test('off: a finished turn on every interval makes no model call and no write', { options: { extractor: 'off', reviewInterval: 1 } }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(w.modelPrompts).toEqual([])
    expect(writes(w)).toEqual([])
  })

  test('turn mode writes the extracted fact with the auto-extract tag', { options: TURN_MODE }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)

    expect(writes(w).length).toBe(1)
    const sent = writes(w)[0]?.args ?? {}
    expect(sent.content).toBe('The project ships with pnpm only.')
    expect(sent.namespace).toBe('project:proj')
    expect(sent.tags).toEqual(['auto-extract'])
    expect((w.state.stats as { writes: number }).writes).toBe(1)
    expect(w.state.extractedThrough).toBe(2)
  })

  test('turn mode searches for the old version and writes once with supersedes', { options: TURN_MODE }, async ($, on) => {
    const OLD_ID = '11111111-2222-4333-8444-555555555555'
    const w = world(on, (tool) => {
      if (tool === 'memory_search') return json({ hits: [{ ...HIT, id: OLD_ID, namespace: 'project:proj', content: 'The project ships with npm.', similarity: 0.9 }, { ...HIT, id: 'far', similarity: 0.3 }] })
      return json({ id: 'w2' })
    })
    w.messages = TURNS
    // One model stub answers both calls: the judge reads the leading YES, the extractor reads the JSON line.
    w.modelText = `YES\n${FACT_LINE}`
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)

    const asked = searches(w).find((c) => c.args.query === 'The project ships with pnpm only.')
    expect(asked?.args).toEqual({ query: 'The project ships with pnpm only.', namespaces: ['project:proj'], limit: 3 })
    expect(writes(w).length).toBe(1)
    expect(writes(w)[0]?.args.supersedes).toBe(OLD_ID)
  })

  test('turn mode writes plain when the old-version search fails', { options: TURN_MODE }, async ($, on) => {
    const w = world(on, (tool) => {
      if (tool === 'memory_search') throw new Error('boom')
      return json({ id: 'w3' })
    })
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(writes(w).length).toBe(1)
    expect('supersedes' in (writes(w)[0]?.args ?? {})).toBe(false)
  })

  test('turn mode reads only the messages since its last run', { options: TURN_MODE }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(w.modelPrompts.length).toBe(1)

    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(w.modelPrompts.length).toBe(1)
  })

  test('turn mode skips a turn that was interrupted', { options: TURN_MODE }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete({ ...DONE, reason: 'aborted', isAborted: true })
    await w.clock.advance(1000)
    expect(w.modelPrompts).toEqual([])
  })

  test('turn mode waits for the interval', { options: { extractor: 'turn', reviewInterval: 4 } }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    w.turns = 3
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(w.modelPrompts).toEqual([])
  })

  test('a model that answers NONE writes nothing', { options: TURN_MODE }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = 'NONE'
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(w.modelPrompts.length).toBe(1)
    expect(writes(w)).toEqual([])
  })

  test('the turn hook returns before the extraction runs', { options: TURN_MODE }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    const out = await $.turn.complete(DONE)
    expect(out.text).toBe('ok')
    expect(w.modelPrompts).toEqual([])
    await w.clock.advance(1000)
    expect(w.modelPrompts.length).toBe(1)
  })

  test('session-end mode extracts once as the session ends', { options: { extractor: 'session-end' } }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(w.modelPrompts).toEqual([])

    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
    expect(w.modelPrompts.length).toBe(1)
    expect(writes(w).length).toBe(1)
  })

  test('turn mode does not extract at session end', { options: TURN_MODE }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
    expect(w.modelPrompts).toEqual([])
  })

  test('compaction runs one extraction before it goes on', { options: { extractor: 'turn', reviewInterval: 50 } }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.session.compact({ trigger: 'manual', messages: TURNS })
    expect(w.modelPrompts.length).toBe(1)
    expect(writes(w).length).toBe(1)
    expect(w.compacted.length).toBe(1)
  })

  test('the extractor prompt never carries a recall block, from a hidden row or from a typed message', { options: TURN_MODE }, async ($, on) => {
    const w = world(on)
    const block = `${RECALL_OPEN}\n${DATA_NOTE}\n- [user:me] recalled stale fact (id m9)\n${RECALL_CLOSE}`
    w.messages = [
      { role: 'user', text: 'we ship on pnpm only', toolUses: [] },
      { role: 'user', text: block, toolUses: [] },
      { role: 'assistant', text: 'noted, pnpm only', toolUses: [] },
      { role: 'user', text: `and the tests run on vitest\n${block}`, toolUses: [] },
    ]
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)

    expect(w.modelPrompts.length).toBe(1)
    const prompt = w.modelPrompts[0] ?? ''
    expect(prompt).not.toContain('<lumberroom-recall>')
    expect(prompt).not.toContain('recalled stale fact')
    expect(prompt).toContain('we ship on pnpm only')
    expect(prompt).toContain('and the tests run on vitest')
  })

  test('a memory_write the engine refuses does not pin the window', { options: TURN_MODE }, async ($, on) => {
    const refuse: Answer = (tool, args) =>
      tool === 'memory_write' ? { content: [{ type: 'text', text: "refusing to store this at 'open': a credential" }], isError: true } : engine(tool, args)
    const w = world(on, refuse)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)

    expect(writes(w).length).toBe(1)
    expect(w.state.extractedThrough).toBe(2)

    await $.turn.complete(DONE)
    await w.clock.advance(1000)
    expect(w.modelPrompts.length).toBe(1)
  })

  test('an unreachable memory_write holds the window so the turns are read again', { options: TURN_MODE }, async ($, on) => {
    const down: Answer = (tool, args) => {
      if (tool === 'memory_write') throw new Error('connect ECONNREFUSED')
      return engine(tool, args)
    }
    const w = world(on, down)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.advance(1000)

    expect(writes(w).length).toBe(1)
    expect(w.state.extractedThrough ?? 0).toBe(0)
  })

  test('a write that timed out holds the window', { options: TURN_MODE }, async ($, on) => {
    const hang: Answer = (tool, args) => (tool === 'memory_write' ? new Promise<McpToolResult>(() => {}) : engine(tool, args))
    const w = world(on, hang)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.turn.complete(DONE)
    await w.clock.settle()
    await w.clock.advance(6000)
    await w.clock.settle()

    expect(w.state.extractedThrough ?? 0).toBe(0)
  })

  test('a compaction waits at most 20 s for the extraction, then goes on and leaves the window', { options: { extractor: 'turn', reviewInterval: 50 } }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    w.modelHangs = true
    await $.session.start(START)
    const pending = $.session.compact({ trigger: 'manual', instructions: 'keep the parser', messages: TURNS })
    await w.clock.settle()
    expect(w.compacted).toEqual([])
    await w.clock.advance(19_000)
    expect(w.compacted).toEqual([])
    await w.clock.advance(1_500)
    await pending

    expect(w.compacted.length).toBe(1)
    expect(w.compacted[0]?.instructions).toMatch('keep the parser')
    expect(w.state.extractedThrough ?? 0).toBe(0)
  })

  test('a precompute does not extract', { options: { extractor: 'turn', reviewInterval: 50 } }, async ($, on) => {
    const w = world(on)
    w.messages = TURNS
    w.modelText = FACT_LINE
    await $.session.start(START)
    await $.session.compact({ trigger: 'precompute', messages: TURNS })
    expect(w.modelPrompts).toEqual([])
    expect(w.compacted.length).toBe(1)
  })
})

describe('/lr-import', () => {
  test('without a token answers with the setting hint and posts nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const out = await run($, 'lr-import')
    expect(out.text).toMatch('Ingest token')
    expect(out.text).toMatch('mayIngest')
    expect(w.fetched).toEqual([])
  })

  test('rejects an argument other than all', { options: { ingestToken: 'lr_test' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const out = await run($, 'lr-import', 'everything')
    expect(out.text).toMatch('all')
    expect(w.fetched).toEqual([])
  })

  test('says so when the memory folder holds no files', { options: { ingestToken: 'lr_test' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const out = await run($, 'lr-import')
    expect(out.text).toMatch(/no memory files/i)
    expect(w.fetched).toEqual([])
  })

  test('posts each memory file as one proposal with the engine namespace for its type', { options: { ingestToken: 'lr_test' } }, async ($, on) => {
    const dir = `${HOME}/.claude/projects/-work-proj/memory`
    const file = (type: string, body: string) => `---\nname: n\ndescription: d\ntype: ${type}\n---\n${body}\n`
    const w = world(on, engine, {
      dirs: { [dir]: ['MEMORY.md', 'a.md', 'b.md'] },
      files: { [`${dir}/MEMORY.md`]: '- [a](a.md)', [`${dir}/a.md`]: file('user', 'Prefers short answers.'), [`${dir}/b.md`]: file('project', 'Uses pnpm.') },
    })
    w.http = (url) => {
      if (url.endsWith('/admin/ingest/runs')) return { status: 200, text: JSON.stringify({ run_id: 'r1' }) }
      if (url.endsWith('/admin/ingest/proposals')) return { status: 200, text: JSON.stringify({ proposals_new: 2, proposals_reinforced: 0, refused: 0, blocked: 0 }) }
      return { status: 200, text: '{}' }
    }
    await $.session.start(START)
    const out = await run($, 'lr-import')

    const urls = w.fetched.map((f) => f.url)
    expect(urls[0]).toBe('https://mcp.lumberroom.cloud/admin/ingest/runs')
    expect(urls).toContain('https://mcp.lumberroom.cloud/admin/ingest/proposals')
    expect(urls[urls.length - 1]).toBe('https://mcp.lumberroom.cloud/admin/ingest/runs/r1/close')
    expect(w.fetched[0]?.headers?.Authorization).toBe('Bearer lr_test')
    const body = JSON.parse(w.fetched.find((f) => f.url.endsWith('/proposals'))?.body ?? '{}') as { facts: { content: string; namespace: string }[] }
    expect(body.facts.map((f) => [f.content, f.namespace]).sort()).toEqual([
      ['Prefers short answers.', 'user:me'],
      ['Uses pnpm.', 'project:proj'],
    ])
    expect(out.text).toMatch('2')
  })

  test('a 403 names the missing grant', { options: { ingestToken: 'lr_test' } }, async ($, on) => {
    const dir = `${HOME}/.claude/projects/-work-proj/memory`
    const w = world(on, engine, {
      dirs: { [dir]: ['a.md'] },
      files: { [`${dir}/a.md`]: '---\nname: n\ndescription: d\ntype: user\n---\nPrefers short answers.\n' },
    })
    w.http = () => ({ status: 403, text: 'forbidden' })
    await $.session.start(START)
    const out = await run($, 'lr-import')
    expect(out.text).toMatch('mayIngest')
  })
})

describe('/lr-import wiring', () => {
  const OK = (url: string) => {
    if (url.endsWith('/admin/ingest/runs')) return { status: 200, text: JSON.stringify({ run_id: 'r1' }) }
    if (url.endsWith('/admin/ingest/proposals')) return { status: 200, text: JSON.stringify({ proposals_new: 1, proposals_reinforced: 0, confirmations: 3, refused: 0, blocked: 0 }) }
    return { status: 200, text: '{}' }
  }
  const file = (type: string, body: string) => `---\nname: n\ndescription: d\ntype: ${type}\n---\n${body}\n`

  test('a plain-http engine URL sends nothing and says why', { options: { ingestToken: 'lr_test', baseUrl: 'http://lr.example' } }, async ($, on) => {
    const dir = `${HOME}/.claude/projects/-work-proj/memory`
    const w = world(on, engine, { dirs: { [dir]: ['a.md'] }, files: { [`${dir}/a.md`]: file('user', 'Prefers short answers.') } })
    await $.session.start(START)
    const out = await run($, 'lr-import')
    expect(w.fetched).toEqual([])
    expect(out.text).toMatch('https')
  })

  test('the result line reports confirmations', { options: { ingestToken: 'lr_test' } }, async ($, on) => {
    const dir = `${HOME}/.claude/projects/-work-proj/memory`
    const w = world(on, engine, { dirs: { [dir]: ['a.md'] }, files: { [`${dir}/a.md`]: file('user', 'Prefers short answers.') } })
    w.http = OK
    await $.session.start(START)
    const out = await run($, 'lr-import')
    expect(out.text).toMatch('3 confirmed')
  })

  test('a project path over 200 characters finds its folder by the first 200 characters', { options: { ingestToken: 'lr_test' } }, async ($, on) => {
    const cwd = `/work/${'p'.repeat(240)}`
    const name = cwd.replace(/[^a-zA-Z0-9]/g, '-')
    const folder = `${name.slice(0, 200)}-8f3a2c`
    const projects = `${HOME}/.claude/projects`
    const dir = `${projects}/${folder}/memory`
    const w = world(on, engine, { folders: { [projects]: [folder, 'unrelated'] }, dirs: { [dir]: ['a.md'] }, files: { [`${dir}/a.md`]: file('user', 'Prefers short answers.') } })
    w.cwd = cwd
    w.http = OK
    await $.session.start({ ...START, cwd })
    const out = await run($, 'lr-import')
    expect(w.fetched.some((f) => f.url.endsWith('/proposals'))).toBe(true)
    expect(out.text ?? '').toMatch('1 posted')
  })

  test('a fetch that hangs is reported after 15 s', { options: { ingestToken: 'lr_test' } }, async ($, on) => {
    const dir = `${HOME}/.claude/projects/-work-proj/memory`
    const w = world(on, engine, { dirs: { [dir]: ['a.md'] }, files: { [`${dir}/a.md`]: file('user', 'Prefers short answers.') } })
    w.httpHangs = true
    await $.session.start(START)
    const pending = run($, 'lr-import')
    await w.clock.settle()
    await w.clock.advance(15_000)
    const out = await pending
    expect((out.text ?? '').toLowerCase()).toMatch('timed out')
  })
})

describe('/lr-import all: plan, confirm, skip', () => {
  const projects = `${HOME}/.claude/projects`
  const mem = (type: string, body: string, description = 'd') => `---\nname: n\ndescription: ${description}\ntype: ${type}\n---\n${body}\n`
  const OK = (url: string) => {
    if (url.endsWith('/admin/ingest/runs')) return { status: 200, text: JSON.stringify({ run_id: 'r1' }) }
    if (url.endsWith('/admin/ingest/proposals')) return { status: 200, text: JSON.stringify({ proposals_new: 1, proposals_reinforced: 0, confirmations: 0, refused: 0, blocked: 0 }) }
    return { status: 200, text: '{}' }
  }
  const TOKEN = { options: { ingestToken: 'lr_test' } }

  /** Folders: 1 -tmp-mystery (no path), 2 -work-mono-packages-web (path, git root mono), 3 -work-proj (current), plus two that drop out. */
  const setup = (on: On, modelAnswer: string | ((prompt: string) => string) = 'cool-app') => {
    const dir = (name: string) => `${projects}/${name}/memory`
    const w = world(on, engine, {
      folders: { [projects]: ['-work-proj', '-tmp-mystery', '-work-mono-packages-web', '-nomemory', '-onlyindex'] },
      dirs: {
        [dir('-work-proj')]: ['a.md'],
        [dir('-tmp-mystery')]: ['m.md', 'MEMORY.md'],
        [dir('-work-mono-packages-web')]: ['b.md', 'u.md'],
        [dir('-onlyindex')]: ['MEMORY.md'],
        '/work': [],
        '/work/mono': [],
        '/work/mono/packages': [],
        '/work/mono/packages/web': [],
      },
      files: {
        [`${dir('-work-proj')}/a.md`]: mem('project', 'Uses pnpm.'),
        [`${dir('-tmp-mystery')}/m.md`]: mem('project', 'Mystery uses cargo.', 'how the mystery app builds'),
        [`${dir('-tmp-mystery')}/MEMORY.md`]: '- [m](m.md)',
        [`${dir('-work-mono-packages-web')}/b.md`]: mem('reference', 'Web uses vite.'),
        [`${dir('-work-mono-packages-web')}/u.md`]: mem('user', 'Prefers short answers.'),
        [`${dir('-onlyindex')}/MEMORY.md`]: '- nothing',
        '/work/mono/.git': '',
      },
    })
    w.modelFor = typeof modelAnswer === 'function' ? modelAnswer : () => modelAnswer
    w.http = OK
    return w
  }
  const proposalsOf = (w: { fetched: { url: string; body?: string }[] }) =>
    w.fetched
      .filter((f) => f.url.endsWith('/proposals'))
      .map((f) => (JSON.parse(f.body ?? '{}') as { facts: { content: string; namespace: string }[] }).facts.map((x) => [x.content, x.namespace]))
  const runsOpened = (w: { fetched: { url: string }[] }) => w.fetched.filter((f) => f.url.endsWith('/admin/ingest/runs')).length

  test('all lists each folder with parseable memory files, numbered, and makes no network call', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    const out = (await run($, 'lr-import', 'all')).text ?? ''

    expect(w.fetched).toEqual([])
    expect(writes(w)).toEqual([])
    const rows = out.split('\n').filter((l) => /^\d+\s+-/.test(l))
    expect(rows.map((r) => r.split(/\s+/)[1])).toEqual(['-tmp-mystery', '-work-mono-packages-web', '-work-proj'])
    expect(rows.map((r) => r.split(/\s+/)[2])).toEqual(['1', '2', '1'])
    expect(out).not.toContain('-nomemory')
    expect(out).not.toContain('-onlyindex')
    expect(out).toMatch(/nothing is posted until you confirm/i)
  })

  test('a model answer that is a slug becomes the proposal, marked as a model guess', TOKEN, async ($, on) => {
    const w = setup(on, 'cool-app')
    await $.session.start(START)
    const out = (await run($, 'lr-import', 'all')).text ?? ''
    const row = out.split('\n').find((l) => l.includes('-tmp-mystery')) ?? ''
    expect(row).toContain('project:cool-app')
    expect(row).toContain('model guess')
    expect(w.modelPrompts.length).toBe(1)
    expect(w.modelPrompts[0]).toContain('-tmp-mystery')
    expect(w.modelPrompts[0]).toContain('how the mystery app builds')
  })

  test('an unusable model answer falls back to global and says so', TOKEN, async ($, on) => {
    setup(on, 'I think this one is about the mystery app')
    await $.session.start(START)
    const out = (await run($, 'lr-import', 'all')).text ?? ''
    const row = out.split('\n').find((l) => l.includes('-tmp-mystery')) ?? ''
    expect(row).toContain('global')
    expect(row).not.toContain('project:')
    expect(row).toContain('unusable')
  })

  test('a model answer of global is global', TOKEN, async ($, on) => {
    setup(on, 'global')
    await $.session.start(START)
    const row = ((await run($, 'lr-import', 'all')).text ?? '').split('\n').find((l) => l.includes('-tmp-mystery')) ?? ''
    expect(row).toContain('global')
    expect(row).toContain('model guess')
    expect(row).not.toContain('unusable')
  })

  test('a model that gives no answer falls back to global', TOKEN, async ($, on) => {
    const w = setup(on)
    w.modelFor = undefined
    await $.session.start(START)
    const row = ((await run($, 'lr-import', 'all')).text ?? '').split('\n').find((l) => l.includes('-tmp-mystery')) ?? ''
    expect(row).toContain('global')
  })

  test('a folder name that decodes to an existing path takes that path git root slug, not the model guess', TOKEN, async ($, on) => {
    const w = setup(on, 'wrong-guess')
    await $.session.start(START)
    const out = (await run($, 'lr-import', 'all')).text ?? ''
    const row = out.split('\n').find((l) => l.includes('-work-mono-packages-web')) ?? ''
    expect(row).toContain('project:mono')
    expect(row).toContain('path found')
    expect(row).not.toContain('wrong-guess')
    expect(w.modelPrompts.every((p) => !p.includes('-work-mono-packages-web'))).toBe(true)
  })

  test('the current project folder takes the current slug', TOKEN, async ($, on) => {
    setup(on)
    await $.session.start(START)
    const row = ((await run($, 'lr-import', 'all')).text ?? '').split('\n').find((l) => l.includes('-work-proj')) ?? ''
    expect(row).toContain('project:proj')
    expect(row).toContain('current project')
  })

  test('all builds the plan without an ingest token', async ($, on) => {
    setup(on)
    await $.session.start(START)
    const out = (await run($, 'lr-import', 'all')).text ?? ''
    expect(out).toContain('-work-mono-packages-web')
  })

  test('plan shows the same table again', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    const built = (await run($, 'lr-import', 'all')).text
    const prompts = w.modelPrompts.length
    const again = (await run($, 'lr-import', 'plan')).text
    expect(again).toBe(built)
    expect(w.modelPrompts.length).toBe(prompts)
  })

  test('plan with no plan says to run all first', TOKEN, async ($, on) => {
    setup(on)
    await $.session.start(START)
    expect((await run($, 'lr-import', 'plan')).text).toMatch('/lr-import all')
  })

  test('confirm n posts that folder with its proposed namespace and marks it done', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    const out = (await run($, 'lr-import', 'confirm 1')).text ?? ''

    expect(runsOpened(w)).toBe(1)
    expect(proposalsOf(w)).toEqual([[['Mystery uses cargo.', 'project:cool-app']]])
    expect(out).toContain('-tmp-mystery')
    expect(out).toContain('project:cool-app')
    const plan = (await run($, 'lr-import', 'plan')).text ?? ''
    expect((plan.split('\n').find((l) => l.includes('-tmp-mystery')) ?? '')).toContain('done')
    expect((plan.split('\n').find((l) => l.includes('-work-proj')) ?? '')).toContain('pending')
  })

  test('confirm by folder name posts that folder', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    await run($, 'lr-import', 'confirm -work-proj')
    expect(proposalsOf(w)).toEqual([[['Uses pnpm.', 'project:proj']]])
  })

  test('confirm with a namespace overrides the proposal, and user memories still go to user:me', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    await run($, 'lr-import', 'confirm 2 renamed-web')
    expect(proposalsOf(w)[0]?.slice().sort()).toEqual([
      ['Prefers short answers.', 'user:me'],
      ['Web uses vite.', 'project:renamed-web'],
    ])
  })

  test('confirm with global sends project memories to global', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    await run($, 'lr-import', 'confirm 1 global')
    expect(proposalsOf(w)).toEqual([[['Mystery uses cargo.', 'global']]])
  })

  test('confirm with a namespace the engine would rewrite posts nothing', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    const out = (await run($, 'lr-import', 'confirm 1 My Repo!')).text ?? ''
    expect(w.fetched).toEqual([])
    expect(out).toMatch(/usage|namespace/i)
  })

  test('confirm for a number outside the plan or an unknown folder posts nothing', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    expect((await run($, 'lr-import', 'confirm 9')).text).toMatch('/lr-import plan')
    expect((await run($, 'lr-import', 'confirm -no-such')).text).toMatch('/lr-import plan')
    expect(w.fetched).toEqual([])
  })

  test('confirm with no plan says to run all first and posts nothing', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    expect((await run($, 'lr-import', 'confirm 1')).text).toMatch('/lr-import all')
    expect(w.fetched).toEqual([])
  })

  test('confirm without an ingest token answers with the setting hint and posts nothing', async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    expect((await run($, 'lr-import', 'confirm 1')).text).toMatch('mayIngest')
    expect(w.fetched).toEqual([])
  })

  test('confirm for a folder already done posts nothing a second time', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    await run($, 'lr-import', 'confirm 1')
    const out = (await run($, 'lr-import', 'confirm 1')).text ?? ''
    expect(runsOpened(w)).toBe(1)
    expect(out).toMatch(/already/i)
  })

  test('skip drops one folder from confirm all, and the numbers stay put', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    const skipped = (await run($, 'lr-import', 'skip 2')).text ?? ''
    expect(skipped).toContain('-work-mono-packages-web')
    await run($, 'lr-import', 'confirm all')

    expect(runsOpened(w)).toBe(2)
    expect(proposalsOf(w).flat().map((f) => f[0]).sort()).toEqual(['Mystery uses cargo.', 'Uses pnpm.'])
    const plan = (await run($, 'lr-import', 'plan')).text ?? ''
    expect((plan.split('\n').find((l) => l.includes('-work-mono-packages-web')) ?? '')).toContain('skipped')
  })

  test('confirm all posts every pending folder with its proposal, one run each', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    const out = (await run($, 'lr-import', 'confirm all')).text ?? ''

    expect(runsOpened(w)).toBe(3)
    expect(proposalsOf(w).flat().sort()).toEqual(
      [
        ['Mystery uses cargo.', 'project:cool-app'],
        ['Prefers short answers.', 'user:me'],
        ['Uses pnpm.', 'project:proj'],
        ['Web uses vite.', 'project:mono'],
      ].sort(),
    )
    expect(out).toContain('-tmp-mystery')
    expect(out).toContain('-work-proj')
  })

  test('confirm all stops at the first failure and leaves the rest pending', TOKEN, async ($, on) => {
    const w = setup(on)
    w.http = () => ({ status: 403, text: 'forbidden' })
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    const out = (await run($, 'lr-import', 'confirm all')).text ?? ''

    expect(out).toContain('mayIngest')
    expect(runsOpened(w)).toBe(1)
    const plan = (await run($, 'lr-import', 'plan')).text ?? ''
    expect(plan.split('\n').filter((l) => /^\d+\s+-/.test(l)).every((l) => l.includes('pending'))).toBe(true)
  })

  test('running all again builds a fresh plan', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    await run($, 'lr-import', 'confirm 1')
    const again = (await run($, 'lr-import', 'all')).text ?? ''
    expect((again.split('\n').find((l) => l.includes('-tmp-mystery')) ?? '')).toContain('pending')
    expect(w.modelPrompts.length).toBe(2)
  })

  test('the plan sits in the store under lr-import:plan', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import', 'all')
    const stored = w.stored['lr-import:plan'] as { folder: string }[]
    expect(stored.map((e) => e.folder)).toEqual(['-tmp-mystery', '-work-mono-packages-web', '-work-proj'])
  })

  test('plain /lr-import still reads only this project', TOKEN, async ($, on) => {
    const w = setup(on)
    await $.session.start(START)
    await run($, 'lr-import')
    expect(proposalsOf(w)).toEqual([[['Uses pnpm.', 'project:proj']]])
    expect(w.modelPrompts).toEqual([])
  })
})
