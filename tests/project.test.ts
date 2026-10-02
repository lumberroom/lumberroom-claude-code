import { describe, expect, test } from 'claude-code/testing'

import { findGitRoot, resolveProject, slugFromPath } from '../src/project'

const existsIn = (...paths: string[]) => async (p: string) => paths.includes(p)

describe('findGitRoot', () => {
  test('finds .git as a folder in a parent', async () => {
    expect(await findGitRoot('/a/b/c', existsIn('/a/.git'))).toBe('/a')
  })

  test('finds .git as a worktree file in the cwd itself', async () => {
    expect(await findGitRoot('/a/b', existsIn('/a/b/.git'))).toBe('/a/b')
  })

  test('takes the nearest root', async () => {
    expect(await findGitRoot('/a/b/c', existsIn('/a/.git', '/a/b/.git'))).toBe('/a/b')
  })

  test('returns null at the filesystem root', async () => {
    expect(await findGitRoot('/a/b', existsIn())).toBeNull()
    expect(await findGitRoot('/', existsIn())).toBeNull()
  })

  test('tolerates a trailing slash', async () => {
    expect(await findGitRoot('/a/b/', existsIn('/a/.git'))).toBe('/a')
  })
})

describe('slugFromPath', () => {
  test('lowercases the basename', async () => {
    expect(slugFromPath('/w/Lumberroom-Cloud')).toBe('lumberroom-cloud')
  })

  test('collapses runs of odd characters into one dash', async () => {
    expect(slugFromPath('/w/My  Project!!x')).toBe('my-project-x')
    expect(slugFromPath('/w/a b_c.d')).toBe('a-b_c.d')
  })

  test('ignores a trailing slash', async () => {
    expect(slugFromPath('/w/proj/')).toBe('proj')
  })

  // The engine's project_slug (ENG src/domain/namespaces.rs): the plugin and the engine must agree.
  for (const [input, want] of [
    ['Foo Bar - Notes', 'foo-bar-notes'],
    ['repo (old)', 'repo-old'],
    ['my--repo', 'my-repo'],
    ['Café', 'caf'],
    ['My Project (v2)', 'my-project-v2'],
    ['/Users/example/work/acme/memoryEngine', 'memoryengine'],
    ['/Users/example/work/acme/memoryEngine/', 'memoryengine'],
    ['/w/--lead-and-trail--', 'lead-and-trail'],
    ['/w/a.b_c', 'a.b_c'],
    ['/w/.hidden', '.hidden'],
    ['/w/日本語repo', 'repo'],
    ['/w/İstanbul', 'stanbul'],
    ['/w/\u212Aelvin', 'elvin'],
    ['///', ''],
    ['', ''],
  ] as const) {
    test(`engine parity: ${JSON.stringify(input)} -> ${JSON.stringify(want)}`, async () => {
      expect(slugFromPath(input)).toBe(want)
    })
  }

  test('engine parity: a slug is cut at 127 characters', async () => {
    expect(slugFromPath(`/w/${'a'.repeat(200)}`)).toBe('a'.repeat(127))
  })

  test('engine parity: the engine trims dashes before it cuts, so a cut can end in one', async () => {
    expect(slugFromPath(`/w/${'a'.repeat(126)}-bbb`)).toBe(`${'a'.repeat(126)}-`)
  })

  test('auto sends no project when the folder name has nothing usable', async () => {
    expect(await resolveProject('auto', '/w/日本語', existsIn())).toBeUndefined()
  })
})

describe('resolveProject', () => {
  test('none sends no project', async () => {
    expect(await resolveProject('none', '/w/p', existsIn('/w/p/.git'))).toBeUndefined()
  })

  test('auto uses the git root slug', async () => {
    expect(await resolveProject('auto', '/w/Repo/src/x', existsIn('/w/Repo/.git'))).toBe('repo')
  })

  test('auto without a git root uses the cwd slug', async () => {
    expect(await resolveProject('auto', '/w/Some Dir', existsIn())).toBe('some-dir')
  })

  test('an explicit slug is returned trimmed and as given', async () => {
    expect(await resolveProject('  My-Slug ', '/w/p', existsIn())).toBe('My-Slug')
  })
})
