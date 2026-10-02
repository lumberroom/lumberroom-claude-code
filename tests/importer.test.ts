import { describe, expect, test } from 'claude-code/testing'

import {
  BATCH_SIZE,
  EXTRACTOR,
  IMPORT_TAG,
  SPEAKER,
  entryUuid,
  namespaceFor,
  parseMemoryFile,
  checkBaseUrl,
  postProposals,
  projectDirMatches,
  projectDirName,
  toProposalFacts,
} from '../src/importer'
import type { HttpDeps, MemoryFile, ProposalFact } from '../src/importer'

const NESTED = `---
name: prefers-short-commits
description: commit message style
metadata:
  type: feedback
---
Keep commit messages short and imperative.
`

const TOP_LEVEL = `---
name: owner-role
description: who the owner is
type: user
---
The owner is a solo developer.
`

describe('projectDirName', () => {
  test('turns slashes into dashes', () => {
    expect(projectDirName('/home/a/work/lumberroom-cloud')).toBe('-home-a-work-lumberroom-cloud')
  })

  test('turns dots into dashes', () => {
    expect(projectDirName('/home/a/work/my.app.v2')).toBe('-home-a-work-my-app-v2')
    expect(projectDirName('/home/a/.config/x')).toBe('-home-a--config-x')
  })

  // Claude Code 2.1.287 builds the folder with replace(/[^a-zA-Z0-9]/g, "-").
  test('turns every character outside [a-zA-Z0-9] into a dash', () => {
    expect(projectDirName('/home/a/my_proj/x y+z')).toBe('-home-a-my-proj-x-y-z')
    expect(projectDirName('/home/a/Caf\u00e9')).toBe('-home-a-Caf-')
    expect(projectDirName('/home/a/\u65e5\u672c')).toBe('-home-a---')
    expect(projectDirName('C:\\Users\\a')).toBe('C--Users-a')
  })

  test('keeps letter case and digits', () => {
    expect(projectDirName('/Work/Proj2')).toBe('-Work-Proj2')
  })
})

describe('projectDirMatches', () => {
  const long = `-${'a'.repeat(250)}`
  test('a name of 200 characters or fewer matches only itself', () => {
    expect(projectDirMatches('-home-a-proj', '-home-a-proj')).toBe(true)
    expect(projectDirMatches('-home-a-proj', '-home-a-proj-other')).toBe(false)
    expect(projectDirMatches('x'.repeat(200), 'x'.repeat(200))).toBe(true)
  })
  // The binary cuts a name over 200 characters and appends a hash, so only the first 200 survive.
  test('a longer name matches a folder that starts with its first 200 characters', () => {
    expect(projectDirMatches(long, `${long.slice(0, 200)}-1a2b3c`)).toBe(true)
    expect(projectDirMatches(long, `${long.slice(0, 199)}b-1a2b3c`)).toBe(false)
    expect(projectDirMatches(long, long.slice(0, 150))).toBe(false)
  })
})

describe('checkBaseUrl', () => {
  test('accepts https', () => {
    expect(checkBaseUrl('https://mcp.lumberroom.cloud')).toBeNull()
    expect(checkBaseUrl('HTTPS://lr.example:8443/x')).toBeNull()
  })
  test('accepts http for localhost and 127.0.0.1 only', () => {
    expect(checkBaseUrl('http://localhost:8080')).toBeNull()
    expect(checkBaseUrl('http://127.0.0.1:8080')).toBeNull()
    expect(checkBaseUrl('http://LOCALHOST')).toBeNull()
    expect(checkBaseUrl('http://lr.example')).not.toBeNull()
    expect(checkBaseUrl('http://10.0.0.5:8080')).not.toBeNull()
  })
  test('a localhost name in the userinfo or the path does not make the host local', () => {
    expect(checkBaseUrl('http://localhost@evil.example')).not.toBeNull()
    expect(checkBaseUrl('http://evil.example/localhost')).not.toBeNull()
    expect(checkBaseUrl('http://localhost.evil.example')).not.toBeNull()
  })
  test('refuses another scheme and text that is no URL', () => {
    expect(checkBaseUrl('ftp://localhost')).not.toBeNull()
    expect(checkBaseUrl('lr.example')).not.toBeNull()
    expect(checkBaseUrl('')).not.toBeNull()
  })
})

describe('parseMemoryFile', () => {
  test('reads a type nested under metadata', () => {
    expect(parseMemoryFile('feedback_commits.md', NESTED)).toEqual({
      name: 'prefers-short-commits',
      description: 'commit message style',
      type: 'feedback',
      body: 'Keep commit messages short and imperative.',
    })
  })

  test('reads a top-level type', () => {
    expect(parseMemoryFile('user_role.md', TOP_LEVEL)).toEqual({
      name: 'owner-role',
      description: 'who the owner is',
      type: 'user',
      body: 'The owner is a solo developer.',
    })
  })

  test('strips quotes from frontmatter values', () => {
    const text = '---\nname: "quoted"\ndescription: \'one line\'\ntype: project\n---\nbody\n'
    const file = parseMemoryFile('p.md', text)
    expect(file?.name).toBe('quoted')
    expect(file?.description).toBe('one line')
  })

  test('reads CRLF line endings', () => {
    const file = parseMemoryFile('c.md', NESTED.replace(/\n/g, '\r\n'))
    expect(file?.type).toBe('feedback')
    expect(file?.body).toBe('Keep commit messages short and imperative.')
  })

  test('keeps a body that holds its own --- rule', () => {
    const text = '---\nname: n\ndescription: d\ntype: project\n---\nfirst\n\n---\n\nsecond\n'
    expect(parseMemoryFile('r.md', text)?.body).toBe('first\n\n---\n\nsecond')
  })

  test('ignores a type key that sits inside another nested block', () => {
    const text = '---\nname: n\ndescription: d\nextra:\n  type: bogus\ntype: reference\n---\nbody\n'
    expect(parseMemoryFile('e.md', text)?.type).toBe('reference')
  })

  test('returns null for MEMORY.md', () => {
    expect(parseMemoryFile('MEMORY.md', NESTED)).toBeNull()
  })

  test('returns null for MEMORY.md given with a directory', () => {
    expect(parseMemoryFile('memory/MEMORY.md', NESTED)).toBeNull()
  })

  test('returns null with no frontmatter', () => {
    expect(parseMemoryFile('plain.md', '# Just a note\n\nno frontmatter\n')).toBeNull()
  })

  test('returns null for an unclosed frontmatter block', () => {
    expect(parseMemoryFile('open.md', '---\nname: n\ntype: user\nbody without a close\n')).toBeNull()
  })

  test('returns null for an empty body', () => {
    expect(parseMemoryFile('empty.md', '---\nname: n\ndescription: d\ntype: user\n---\n  \n')).toBeNull()
  })
})

describe('namespaceFor', () => {
  test('sends user and feedback to user:me', () => {
    expect(namespaceFor('user', 'demo-app')).toBe('user:me')
    expect(namespaceFor('feedback', null)).toBe('user:me')
  })

  test('sends project and reference to the project namespace', () => {
    expect(namespaceFor('project', 'demo-app')).toBe('project:demo-app')
    expect(namespaceFor('reference', 'demo-app')).toBe('project:demo-app')
  })

  test('falls back to global with no slug', () => {
    expect(namespaceFor('project', null)).toBe('global')
    expect(namespaceFor('reference', null)).toBe('global')
  })

  test('sends an unknown type to global', () => {
    expect(namespaceFor('mystery', 'demo-app')).toBe('global')
    expect(namespaceFor('', 'demo-app')).toBe('global')
  })
})

describe('entryUuid', () => {
  test('is 64 hex characters', async () => {
    expect(/^[0-9a-f]{64}$/.test(await entryUuid('some body'))).toBe(true)
  })

  test('is stable for equal input and differs for other input', async () => {
    expect(await entryUuid('same')).toBe(await entryUuid('same'))
    expect((await entryUuid('same')) === (await entryUuid('other'))).toBe(false)
  })

  test('matches the SHA-256 of the UTF-8 body', async () => {
    expect(await entryUuid('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('toProposalFacts', () => {
  const file: MemoryFile = { name: 'n', description: 'd', type: 'feedback', body: 'Keep commits short.' }

  test('builds the fields the proposal queue reads', async () => {
    const [fact] = await toProposalFacts([{ path: '/home/a/.claude/projects/-x/memory/f.md', file }], 'demo-app', 'run-1')
    expect(fact).toEqual({
      content: 'Keep commits short.',
      namespace: 'user:me',
      tags: [IMPORT_TAG],
      speaker: SPEAKER,
      span_text: 'Keep commits short.',
      source: {
        file_path: '/home/a/.claude/projects/-x/memory/f.md',
        entry_uuid: await entryUuid('Keep commits short.'),
        run_id: 'run-1',
      },
    })
  })

  test('uses main_model as the speaker and claude-code-import as the tag', () => {
    expect(SPEAKER).toBe('main_model')
    expect(IMPORT_TAG).toBe('claude-code-import')
  })

  test('routes a project file to the project namespace', async () => {
    const projectFile: MemoryFile = { ...file, type: 'project' }
    const [fact] = await toProposalFacts([{ path: '/p.md', file: projectFile }], 'demo-app', 'r')
    expect(fact?.namespace).toBe('project:demo-app')
  })

  test('keeps one fact per file in order', async () => {
    const facts = await toProposalFacts(
      [
        { path: '/a.md', file: { ...file, body: 'one' } },
        { path: '/b.md', file: { ...file, body: 'two' } },
      ],
      null,
      'r',
    )
    expect(facts.map(f => f.content)).toEqual(['one', 'two'])
  })
})

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

type Reply = { status: number; body: unknown }

const HANG = Symbol('hang')

interface Sleep {
  ms: number
  release: () => void
}

function fakeHttp(reply: (call: Call, index: number) => Reply | Error | typeof HANG): { deps: HttpDeps; calls: Call[]; sleeps: Sleep[] } {
  const calls: Call[] = []
  const sleeps: Sleep[] = []
  const deps: HttpDeps = {
    fetch: async (url, init) => {
      const call: Call = { url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) }
      calls.push(call)
      const r = reply(call, calls.length - 1)
      if (r === HANG) return new Promise<never>(() => {})
      if (r instanceof Error) throw r
      return { status: r.status, ok: r.status >= 200 && r.status < 300, text: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) }
    },
    // A timer a test releases by hand; one nobody releases never fires.
    sleep: (ms) => new Promise<void>((resolve) => sleeps.push({ ms, release: resolve })),
  }
  return { deps, calls, sleeps }
}

/** Lets the pending microtasks run so a race has registered its timer. */
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function factsOf(n: number, runId: string): ProposalFact[] {
  return Array.from({ length: n }, (_, i) => ({
    content: `fact ${i}`,
    namespace: 'user:me',
    tags: [IMPORT_TAG],
    speaker: SPEAKER,
    span_text: `fact ${i}`,
    source: { file_path: `/f${i}.md`, entry_uuid: `${i}`, run_id: runId },
  }))
}

const BASE = 'https://lr.example'

describe('postProposals', () => {
  test('opens a run, posts 150 facts as 100 and 50, closes, and sums the counts', async () => {
    const { deps, calls } = fakeHttp((call, i) => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'run-9' } }
      if (call.url.endsWith('/admin/ingest/proposals')) {
        return i === 1
          ? { status: 200, body: { proposals_new: 80, proposals_reinforced: 10, refused: 6, blocked: 4 } }
          : { status: 200, body: { proposals_new: 40, proposals_reinforced: 5, refused: 3, blocked: 2 } }
      }
      return { status: 200, body: {} }
    })
    const report = await postProposals(deps, BASE, 'tok', async runId => factsOf(150, runId), 150)

    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      `POST ${BASE}/admin/ingest/runs`,
      `POST ${BASE}/admin/ingest/proposals`,
      `POST ${BASE}/admin/ingest/proposals`,
      `POST ${BASE}/admin/ingest/runs/run-9/close`,
    ])
    expect(calls[0]?.body).toEqual({ extractor: EXTRACTOR, scope: { tool: 'claude-code' } })
    const first = calls[1]?.body as { extractor: string; facts: ProposalFact[] }
    const second = calls[2]?.body as { extractor: string; facts: ProposalFact[] }
    expect(first.extractor).toBe(EXTRACTOR)
    expect(first.facts.length).toBe(BATCH_SIZE)
    expect(second.facts.length).toBe(50)
    expect(first.facts[0]?.source.run_id).toBe('run-9')
    for (const c of calls) expect(c.headers.Authorization).toBe('Bearer tok')

    expect(report).toEqual({
      runId: 'run-9',
      files: 150,
      posted: 150,
      proposalsNew: 120,
      proposalsReinforced: 15,
      confirmations: 0,
      refused: 9,
      blocked: 6,
    })
  })

  test('sends the run counters on close', async () => {
    const { deps, calls } = fakeHttp(call => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'r' } }
      if (call.url.endsWith('/admin/ingest/proposals')) return { status: 200, body: { proposals_new: 2, proposals_reinforced: 1 } }
      return { status: 200, body: {} }
    })
    await postProposals(deps, `${BASE}/`, 't', async runId => factsOf(3, runId), 3)
    expect(calls[0]?.url).toBe(`${BASE}/admin/ingest/runs`)
    const close = calls[calls.length - 1]?.body as Record<string, number>
    expect(close.entries_seen).toBe(3)
    expect(close.proposals_new).toBe(2)
    expect(close.proposals_reinforced).toBe(1)
  })

  test('a 403 on run open names mayIngest and posts nothing', async () => {
    let built = false
    const { deps, calls } = fakeHttp(() => ({ status: 403, body: { error: 'forbidden' } }))
    const report = await postProposals(deps, BASE, 't', async runId => {
      built = true
      return factsOf(5, runId)
    }, 5)
    expect(calls.length).toBe(1)
    expect(built).toBe(false)
    expect(report.error?.includes('mayIngest')).toBe(true)
    expect(report.runId).toBeNull()
    expect(report.posted).toBe(0)
  })

  test('a 403 on a batch names mayIngest and still closes the run', async () => {
    const { deps, calls } = fakeHttp(call => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'r' } }
      if (call.url.endsWith('/admin/ingest/proposals')) return { status: 403, body: 'no' }
      return { status: 200, body: {} }
    })
    const report = await postProposals(deps, BASE, 't', async runId => factsOf(3, runId), 3)
    expect(report.error?.includes('mayIngest')).toBe(true)
    expect(calls[calls.length - 1]?.url.endsWith('/admin/ingest/runs/r/close')).toBe(true)
  })

  test('a 500 on a batch stops the batches and still closes the run', async () => {
    const { deps, calls } = fakeHttp((call, i) => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'r' } }
      if (call.url.endsWith('/admin/ingest/proposals')) {
        return i === 1
          ? { status: 200, body: { proposals_new: 100 } }
          : { status: 500, body: 'x'.repeat(500) }
      }
      return { status: 200, body: {} }
    })
    const report = await postProposals(deps, BASE, 't', async runId => factsOf(250, runId), 250)
    expect(calls.map(c => c.url.replace(BASE, ''))).toEqual([
      '/admin/ingest/runs',
      '/admin/ingest/proposals',
      '/admin/ingest/proposals',
      '/admin/ingest/runs/r/close',
    ])
    expect(report.posted).toBe(100)
    expect(report.proposalsNew).toBe(100)
    expect(report.error?.includes('500')).toBe(true)
    expect(report.error?.includes('x'.repeat(200))).toBe(true)
    expect(report.error?.includes('x'.repeat(201))).toBe(false)
  })

  test('a transport failure on a batch is reported and the run still closes', async () => {
    const { deps, calls } = fakeHttp(call => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'r' } }
      if (call.url.endsWith('/admin/ingest/proposals')) return new Error('connection reset')
      return { status: 200, body: {} }
    })
    const report = await postProposals(deps, BASE, 't', async runId => factsOf(2, runId), 2)
    expect(report.error?.includes('connection reset')).toBe(true)
    expect(calls[calls.length - 1]?.url.endsWith('/close')).toBe(true)
  })

  test('a transport failure on run open reports it and posts nothing', async () => {
    const { deps, calls } = fakeHttp(() => new Error('dns failure'))
    const report = await postProposals(deps, BASE, 't', async runId => factsOf(2, runId), 2)
    expect(calls.length).toBe(1)
    expect(report.error?.includes('dns failure')).toBe(true)
    expect(report.runId).toBeNull()
  })

  test('a run-open reply with no run_id is an error', async () => {
    const { deps, calls } = fakeHttp(() => ({ status: 200, body: { nope: true } }))
    const report = await postProposals(deps, BASE, 't', async runId => factsOf(2, runId), 2)
    expect(calls.length).toBe(1)
    expect(report.error === undefined).toBe(false)
  })

  test('a run with no facts opens and closes without a batch', async () => {
    const { deps, calls } = fakeHttp(call =>
      call.url.endsWith('/admin/ingest/runs') ? { status: 200, body: { run_id: 'r' } } : { status: 200, body: {} },
    )
    const report = await postProposals(deps, BASE, 't', async () => [], 0)
    expect(calls.map(c => c.url.replace(BASE, ''))).toEqual(['/admin/ingest/runs', '/admin/ingest/runs/r/close'])
    expect(report.posted).toBe(0)
    expect(report.error).toBeUndefined()
  })

  test('a failing build closes the run and reports the error', async () => {
    const { deps, calls } = fakeHttp(call =>
      call.url.endsWith('/admin/ingest/runs') ? { status: 200, body: { run_id: 'r' } } : { status: 200, body: {} },
    )
    const report = await postProposals(deps, BASE, 't', async () => {
      throw new Error('hash failed')
    }, 1)
    expect(report.error?.includes('hash failed')).toBe(true)
    expect(calls[calls.length - 1]?.url.endsWith('/close')).toBe(true)
  })

  test('sums confirmations over the batches and reports them on close', async () => {
    const { deps, calls } = fakeHttp(call => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'r' } }
      if (call.url.endsWith('/admin/ingest/proposals')) return { status: 200, body: { proposals_new: 1, confirmations: 2 } }
      return { status: 200, body: {} }
    })
    const report = await postProposals(deps, BASE, 't', async runId => factsOf(150, runId), 150)
    expect(report.confirmations).toBe(4)
    const close = calls[calls.length - 1]?.body as Record<string, number>
    expect(close.confirmations).toBe(4)
  })

  test('a non-https base URL sends nothing, the token included', async () => {
    const { deps, calls } = fakeHttp(() => ({ status: 200, body: { run_id: 'r' } }))
    const report = await postProposals(deps, 'http://lr.example', 'secret-token', async runId => factsOf(2, runId), 2)
    expect(calls).toEqual([])
    expect(report.error?.includes('https')).toBe(true)
  })

  test('http to localhost goes out', async () => {
    const { deps, calls } = fakeHttp(call =>
      call.url.endsWith('/admin/ingest/runs') ? { status: 200, body: { run_id: 'r' } } : { status: 200, body: {} },
    )
    await postProposals(deps, 'http://127.0.0.1:8080', 't', async () => [], 0)
    expect(calls[0]?.url).toBe('http://127.0.0.1:8080/admin/ingest/runs')
  })

  test('a run open that hangs 15 s reports a timeout and posts nothing', async () => {
    const { deps, calls, sleeps } = fakeHttp(() => HANG)
    const pending = postProposals(deps, BASE, 't', async runId => factsOf(2, runId), 2)
    await tick()
    expect(sleeps.map(x => x.ms)).toEqual([15_000])
    sleeps[0]?.release()
    const report = await pending
    expect(calls.length).toBe(1)
    expect(report.error?.toLowerCase().includes('timed out')).toBe(true)
    expect(report.runId).toBeNull()
  })

  test('a batch that hangs 15 s is reported, and the close still goes out under its own 5 s race', async () => {
    const { deps, calls, sleeps } = fakeHttp(call => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'r' } }
      if (call.url.endsWith('/admin/ingest/proposals')) return HANG
      return { status: 200, body: {} }
    })
    const pending = postProposals(deps, BASE, 't', async runId => factsOf(2, runId), 2)
    await tick()
    // The run open's own timer is still pending; the last 15 s timer belongs to the batch.
    sleeps.filter(x => x.ms === 15_000).at(-1)?.release()
    const report = await pending
    expect(report.error?.toLowerCase().includes('timed out')).toBe(true)
    expect(calls.at(-1)?.url.endsWith('/admin/ingest/runs/r/close')).toBe(true)
    expect(sleeps.at(-1)?.ms).toBe(5_000)
  })

  test('a close that hangs 5 s is reported when nothing else failed', async () => {
    const { deps, sleeps } = fakeHttp(call => {
      if (call.url.endsWith('/admin/ingest/runs')) return { status: 200, body: { run_id: 'r' } }
      if (call.url.endsWith('/close')) return HANG
      return { status: 200, body: {} }
    })
    const pending = postProposals(deps, BASE, 't', async () => [], 0)
    await tick()
    sleeps.filter(x => x.ms === 5_000).at(-1)?.release()
    const report = await pending
    expect(report.error?.toLowerCase().includes('timed out')).toBe(true)
    expect(report.error?.includes('close')).toBe(true)
  })
})
