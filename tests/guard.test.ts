import { describe, expect, test } from 'claude-code/testing'

import { GUARDED_TOOLS, isBuiltinMemoryPath, normalizePath, parentOf, pathArg } from '../src/guard'

const HOME = '/home/a'
const CWD = '/home/a/work/demo'

describe('pathArg', () => {
  test('reads file_path for Read, Write, Edit and MultiEdit', () => {
    for (const tool of ['Read', 'Write', 'Edit', 'MultiEdit']) {
      expect(pathArg(tool, { file_path: '/x/y.md' })).toBe('/x/y.md')
    }
  })

  test('reads notebook_path for NotebookEdit', () => {
    expect(pathArg('NotebookEdit', { notebook_path: '/x/n.ipynb' })).toBe('/x/n.ipynb')
  })

  test('ignores file_path on NotebookEdit and notebook_path on Edit', () => {
    expect(pathArg('NotebookEdit', { file_path: '/x/y.md' })).toBeUndefined()
    expect(pathArg('Edit', { notebook_path: '/x/n.ipynb' })).toBeUndefined()
  })

  test('returns undefined for an unguarded tool or a non-string value', () => {
    expect(pathArg('Bash', { file_path: '/x/y.md' })).toBeUndefined()
    expect(pathArg('Read', { file_path: 7 })).toBeUndefined()
    expect(pathArg('Read', {})).toBeUndefined()
  })

  test('reads path for Grep and Glob', () => {
    for (const tool of ['Grep', 'Glob']) {
      expect(pathArg(tool, { pattern: 'x', path: '/x/dir' })).toBe('/x/dir')
      expect(pathArg(tool, { pattern: 'x' })).toBeUndefined()
      expect(pathArg(tool, { pattern: 'x', file_path: '/x/y.md' })).toBeUndefined()
    }
  })

  test('GUARDED_TOOLS names the five file tools and the two search tools', () => {
    expect([...GUARDED_TOOLS].sort()).toEqual(['Edit', 'Glob', 'Grep', 'MultiEdit', 'NotebookEdit', 'Read', 'Write'])
  })
})

describe('parentOf', () => {
  test('cuts the last segment', () => {
    expect(parentOf('/a/b/c.md')).toEqual({ parent: '/a/b', base: 'c.md' })
  })
  test('ignores trailing slashes', () => {
    expect(parentOf('/a/b/')).toEqual({ parent: '/a', base: 'b' })
  })
  test('a top-level name has the root as parent', () => {
    expect(parentOf('/a')).toEqual({ parent: '/', base: 'a' })
  })
  test('a relative name has no parent to stat', () => {
    expect(parentOf('a.md')).toBeNull()
  })
})

describe('normalizePath', () => {
  test('expands ~ with home', () => {
    expect(normalizePath('~/.claude/MEMORY.md', HOME, CWD)).toBe('/home/a/.claude/MEMORY.md')
    expect(normalizePath('~', HOME, CWD)).toBe('/home/a')
  })

  test('resolves . and .. segments', () => {
    expect(normalizePath('/home/a/work/../.claude/./projects/-x/memory/a.md', HOME, CWD)).toBe(
      '/home/a/.claude/projects/-x/memory/a.md',
    )
  })

  test('cannot climb above the root', () => {
    expect(normalizePath('/../../etc/hosts', HOME, CWD)).toBe('/etc/hosts')
  })

  test('collapses duplicate slashes and a trailing slash', () => {
    expect(normalizePath('/home//a///.claude/projects/-x/memory/', HOME, CWD)).toBe('/home/a/.claude/projects/-x/memory')
  })

  test('resolves a relative path against cwd', () => {
    expect(normalizePath('notes/a.md', HOME, CWD)).toBe('/home/a/work/demo/notes/a.md')
    expect(normalizePath('../../.claude/MEMORY.md', HOME, CWD)).toBe('/home/a/.claude/MEMORY.md')
  })

  test('leaves ~user alone as a relative name', () => {
    expect(normalizePath('~bob/a.md', HOME, CWD)).toBe('/home/a/work/demo/~bob/a.md')
  })
})

describe('isBuiltinMemoryPath', () => {
  test('is true for a file in a project memory folder', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x-y/memory/a.md', HOME)).toBe(true)
  })

  test('is true for the memory folder itself', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x-y/memory', HOME)).toBe(true)
  })

  test('is true for a nested file under the memory folder', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x-y/memory/sub/b.md', HOME)).toBe(true)
  })

  test('is true for MEMORY.md directly under .claude', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/MEMORY.md', HOME)).toBe(true)
  })

  test('is false for a MEMORY.md deeper under .claude, outside a project memory folder', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/plugins/foo/MEMORY.md', HOME)).toBe(false)
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x/MEMORY.md', HOME)).toBe(false)
    expect(isBuiltinMemoryPath('/home/a/.claude/skills/MEMORY.md', HOME)).toBe(false)
  })

  test('is true for MEMORY.md in a project memory folder', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x/memory/MEMORY.md', HOME)).toBe(true)
  })

  test('is false for MEMORY.md outside .claude', () => {
    expect(isBuiltinMemoryPath('/home/a/work/MEMORY.md', HOME)).toBe(false)
  })

  test('is false for a sibling of the memory folder', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x/notes.md', HOME)).toBe(false)
  })

  test('is false for a lookalike projects folder', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects-old/-x/memory/a.md', HOME)).toBe(false)
  })

  test('is false for a lookalike memory folder name', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x/memory-old/a.md', HOME)).toBe(false)
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x/memory.md', HOME)).toBe(false)
  })

  test('is false for another home', () => {
    expect(isBuiltinMemoryPath('/home/b/.claude/projects/-x/memory/a.md', HOME)).toBe(false)
  })

  test('is false for the projects folder and a project folder alone', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/projects', HOME)).toBe(false)
    expect(isBuiltinMemoryPath('/home/a/.claude/projects/-x', HOME)).toBe(false)
  })

  test('accepts a home with a trailing slash', () => {
    expect(isBuiltinMemoryPath('/home/a/.claude/MEMORY.md', '/home/a/')).toBe(true)
  })
})
