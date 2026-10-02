import { describe, expect, test } from 'claude-code/testing'

import {
  buildNamespacePrompt,
  decodeProjectDir,
  formatPlan,
  namespaceLabel,
  parseImportArgs,
  parseNamespaceAnswer,
  parseNamespaceOverride,
  parsePlan,
} from '../src/importplan'
import type { PlanEntry } from '../src/importplan'

const existsIn = (...paths: string[]) => {
  const seen: string[] = []
  const fn = async (p: string) => {
    seen.push(p)
    return paths.includes(p)
  }
  return Object.assign(fn, { seen })
}

const entry = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  folder: '-home-u-work-my-repo',
  files: 4,
  slug: 'my-repo',
  how: 'path',
  reason: 'found /home/u/work/my-repo',
  status: 'pending',
  ...over,
})

describe('decodeProjectDir', () => {
  test('turns every dash into a slash when that path exists', async () => {
    const exists = existsIn('/home', '/home/u', '/home/u/work', '/home/u/work/repo')
    expect(await decodeProjectDir('-home-u-work-repo', exists)).toBe('/home/u/work/repo')
  })

  test('joins dashes back into a segment: my-repo', async () => {
    const exists = existsIn('/home', '/home/u', '/home/u/work', '/home/u/work/my-repo')
    expect(await decodeProjectDir('-home-u-work-my-repo', exists)).toBe('/home/u/work/my-repo')
  })

  test('finds a folder spelled with an underscore or a dot', async () => {
    expect(await decodeProjectDir('-home-u-my-repo', existsIn('/home', '/home/u', '/home/u/my_repo'))).toBe('/home/u/my_repo')
    expect(await decodeProjectDir('-home-u-app-v2', existsIn('/home', '/home/u', '/home/u/app.v2'))).toBe('/home/u/app.v2')
  })

  test('reads a double dash as a hidden folder', async () => {
    const exists = existsIn('/home', '/home/u', '/home/u/.config', '/home/u/.config/x')
    expect(await decodeProjectDir('-home-u--config-x', exists)).toBe('/home/u/.config/x')
  })

  test('answers null when no reading exists', async () => {
    expect(await decodeProjectDir('-home-u-gone', existsIn('/home', '/home/u'))).toBeNull()
  })

  test('answers null for a name that is not a POSIX path', async () => {
    expect(await decodeProjectDir('C--Users-a', existsIn())).toBeNull()
    expect(await decodeProjectDir('', existsIn())).toBeNull()
  })

  test('stops probing at the budget', async () => {
    const exists = existsIn()
    await decodeProjectDir('-a-b-c-d-e-f-g-h', exists, 5)
    expect(exists.seen.length).toBeLessThanOrEqual(5)
  })

  test('does not walk below a folder that is missing', async () => {
    const exists = existsIn('/home/u/work/repo')
    expect(await decodeProjectDir('-home-u-work-repo', exists)).toBeNull()
  })
})

describe('buildNamespacePrompt', () => {
  const files = Array.from({ length: 7 }, (_, i) => ({ name: `file${i}`, description: `about ${i}` }))
  const prompt = buildNamespacePrompt('-home-u-work-my-repo', files)

  test('names the folder and the first five memory files with their descriptions', () => {
    expect(prompt).toContain('-home-u-work-my-repo')
    expect(prompt).toContain('file4: about 4')
    expect(prompt).not.toContain('file5')
  })

  test('asks for a slug or global and nothing else', () => {
    expect(prompt).toMatch(/global/)
    expect(prompt).toMatch(/nothing else/)
  })

  test('clips a long description', () => {
    expect(buildNamespacePrompt('-x', [{ name: 'n', description: 'd'.repeat(500) }]).length).toBeLessThan(900)
  })
})

describe('parseNamespaceAnswer', () => {
  test('accepts a slug', () => {
    expect(parseNamespaceAnswer('my-repo')).toBe('my-repo')
    expect(parseNamespaceAnswer('  lumberroom-cloud\n')).toBe('lumberroom-cloud')
  })

  test('accepts the literal global, in any case', () => {
    expect(parseNamespaceAnswer('global')).toBe('global')
    expect(parseNamespaceAnswer('Global')).toBe('global')
  })

  test('strips quotes and backticks around the answer', () => {
    expect(parseNamespaceAnswer('`my-repo`')).toBe('my-repo')
    expect(parseNamespaceAnswer('"my-repo"')).toBe('my-repo')
  })

  test('lowercases an otherwise valid slug', () => {
    expect(parseNamespaceAnswer('My-Repo')).toBe('my-repo')
  })

  test('refuses a sentence, a path, an empty answer and a name the engine would rewrite', () => {
    expect(parseNamespaceAnswer('I think it is my-repo')).toBeNull()
    expect(parseNamespaceAnswer('/home/u/my-repo')).toBeNull()
    expect(parseNamespaceAnswer('')).toBeNull()
    expect(parseNamespaceAnswer('my--repo')).toBeNull()
    expect(parseNamespaceAnswer('-my-repo')).toBeNull()
    expect(parseNamespaceAnswer('project:my-repo')).toBeNull()
  })
})

describe('parseNamespaceOverride', () => {
  test('a slug, project:slug and global', () => {
    expect(parseNamespaceOverride('my-repo')).toEqual({ ok: true, slug: 'my-repo' })
    expect(parseNamespaceOverride('project:my-repo')).toEqual({ ok: true, slug: 'my-repo' })
    expect(parseNamespaceOverride('global')).toEqual({ ok: true, slug: null })
  })

  test('refuses user:me and a name the engine would rewrite', () => {
    expect(parseNamespaceOverride('user:me').ok).toBe(false)
    expect(parseNamespaceOverride('My Repo').ok).toBe(false)
    expect(parseNamespaceOverride('project:').ok).toBe(false)
  })
})

describe('parseImportArgs', () => {
  test('no argument is the current project', () => {
    expect(parseImportArgs('')).toEqual({ kind: 'current' })
    expect(parseImportArgs('   ')).toEqual({ kind: 'current' })
  })

  test('all builds the plan, plan shows it', () => {
    expect(parseImportArgs('all')).toEqual({ kind: 'build' })
    expect(parseImportArgs('ALL')).toEqual({ kind: 'build' })
    expect(parseImportArgs('plan')).toEqual({ kind: 'plan' })
  })

  test('confirm takes a target and an optional namespace', () => {
    expect(parseImportArgs('confirm 2')).toEqual({ kind: 'confirm', target: '2' })
    expect(parseImportArgs('confirm 2 my-repo')).toEqual({ kind: 'confirm', target: '2', namespace: 'my-repo' })
    expect(parseImportArgs('confirm -home-u-x global')).toEqual({ kind: 'confirm', target: '-home-u-x', namespace: 'global' })
    expect(parseImportArgs('confirm all')).toEqual({ kind: 'confirm', target: 'all' })
  })

  test('skip takes one target', () => {
    expect(parseImportArgs('skip 3')).toEqual({ kind: 'skip', target: '3' })
  })

  test('anything else is usage', () => {
    for (const bad of ['everything', 'confirm', 'skip', 'skip 1 2', 'confirm 1 a b', 'confirm all x', 'plan now']) {
      expect(parseImportArgs(bad)).toEqual({ kind: 'usage' })
    }
  })
})

describe('parsePlan', () => {
  test('keeps well-formed entries', () => {
    expect(parsePlan([entry()])).toEqual([entry()])
  })

  test('answers [] for anything else', () => {
    expect(parsePlan(undefined)).toEqual([])
    expect(parsePlan('x')).toEqual([])
    expect(parsePlan([{ folder: 1 }])).toEqual([])
    expect(parsePlan([entry({ status: 'weird' as never })])).toEqual([])
  })
})

describe('namespaceLabel', () => {
  test('project:slug or global', () => {
    expect(namespaceLabel('my-repo')).toBe('project:my-repo')
    expect(namespaceLabel(null)).toBe('global')
  })
})

describe('formatPlan', () => {
  const out = formatPlan([
    entry(),
    entry({ folder: '-tmp-x', files: 1, slug: null, how: 'model', reason: 'the model guessed global', status: 'done' }),
    entry({ folder: '-tmp-y', files: 2, slug: 'y', how: 'current', status: 'skipped' }),
  ])

  test('numbers the folders from 1, with count, namespace, how it was chosen and status', () => {
    expect(out).toContain('1')
    expect(out).toContain('-home-u-work-my-repo')
    expect(out).toContain('project:my-repo')
    expect(out).toContain('path found')
    expect(out).toContain('model guess')
    expect(out).toContain('current project')
    expect(out).toContain('done')
    expect(out).toContain('skipped')
  })

  test('says nothing is posted and names the next commands', () => {
    expect(out).toContain('/lr-import confirm')
    expect(out).toContain('/lr-import skip')
  })

  test('says so for an empty plan', () => {
    expect(formatPlan([])).toMatch(/no memory folders/i)
  })
})
