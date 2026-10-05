import { describe, expect, test } from 'claude-code/testing'

import { isCovered, manualText, mergeAllow, missingRules, permissionLists, setupRules } from '../src/setup'

const BUNDLED = 'plugin:lumberroom-memory:lumberroom'
const RULES = [
  'mcp__plugin_lumberroom-memory_lumberroom__context_bootstrap',
  'mcp__plugin_lumberroom-memory_lumberroom__memory_search',
  'mcp__plugin_lumberroom-memory_lumberroom__memory_write',
]

describe('setupRules', () => {
  test('names the three tools under the server the plugin runs on', async () => {
    expect(setupRules(BUNDLED)).toEqual(RULES)
    expect(setupRules('claude.ai Lumberroom')[0]).toBe('mcp__claude_ai_Lumberroom__context_bootstrap')
  })
})

describe('isCovered', () => {
  test('takes the rule itself, the server wildcard and the bare server', async () => {
    const rule = RULES[0] ?? ''
    expect(isCovered(rule, [rule])).toBe(true)
    expect(isCovered(rule, ['mcp__plugin_lumberroom-memory_lumberroom__*'])).toBe(true)
    expect(isCovered(rule, ['mcp__plugin_lumberroom-memory_lumberroom'])).toBe(true)
  })

  test('ignores another server, another tool and non-strings', async () => {
    const rule = RULES[0] ?? ''
    expect(isCovered(rule, ['mcp__lumberroom__*', RULES[1], 42, null])).toBe(false)
  })
})

describe('missingRules', () => {
  test('keeps only the rules nothing covers', async () => {
    expect(missingRules(RULES, [RULES[1]])).toEqual([RULES[0], RULES[2]])
    expect(missingRules(RULES, ['mcp__plugin_lumberroom-memory_lumberroom__*'])).toEqual([])
  })
})

describe('permissionLists', () => {
  test('reads allow and deny, empty where absent or malformed', async () => {
    expect(permissionLists({ permissions: { allow: ['a'], deny: ['b'] } })).toEqual({ allow: ['a'], deny: ['b'] })
    expect(permissionLists({ permissions: { allow: 'a' } })).toEqual({ allow: [], deny: [] })
    expect(permissionLists(undefined)).toEqual({ allow: [], deny: [] })
  })
})

describe('mergeAllow', () => {
  test('creates the file when there is none', async () => {
    const r = mergeAllow('', RULES)
    expect(r.ok && JSON.parse(r.text)).toEqual({ permissions: { allow: RULES } })
  })

  test('appends to the allow list and keeps every other key', async () => {
    const text = JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)'], deny: ['Read(.env)'], defaultMode: 'auto' }, hooks: { x: 1 } })
    const r = mergeAllow(text, RULES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(JSON.parse(r.text)).toEqual({ model: 'opus', permissions: { allow: ['Bash(ls)', ...RULES], deny: ['Read(.env)'], defaultMode: 'auto' }, hooks: { x: 1 } })
    expect(r.added).toEqual(RULES)
    expect(r.text.endsWith('}\n')).toBe(true)
  })

  test('adds only what is missing, and leaves the text alone when nothing is', async () => {
    const text = JSON.stringify({ permissions: { allow: [RULES[0]] } })
    const r = mergeAllow(text, RULES)
    expect(r.ok && r.added).toEqual([RULES[1], RULES[2]])
    const covered = JSON.stringify({ permissions: { allow: ['mcp__plugin_lumberroom-memory_lumberroom__*'] } })
    expect(mergeAllow(covered, RULES)).toEqual({ ok: true, text: covered, added: [] })
  })

  test('refuses text it cannot merge rather than overwrite it', async () => {
    expect(mergeAllow('{ "a": 1, // comment\n}', RULES)).toEqual({ ok: false, error: 'it is not valid JSON' })
    expect(mergeAllow('[1]', RULES)).toEqual({ ok: false, error: 'it does not hold a JSON object' })
    expect(mergeAllow('{"permissions": []}', RULES)).toEqual({ ok: false, error: 'its permissions key is not an object' })
    expect(mergeAllow('{"permissions": {"allow": "x"}}', RULES)).toEqual({ ok: false, error: 'its permissions.allow is not a list' })
  })
})

describe('manualText', () => {
  test('names the file and every rule', async () => {
    const text = manualText('/home/u/.claude/settings.json', RULES)
    expect(text).toMatch('/home/u/.claude/settings.json')
    for (const r of RULES) expect(text).toMatch(r)
  })
})
