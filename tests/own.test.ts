import { describe, expect, test } from 'claude-code/testing'

import { allowsOwnCall, OWN_PLUGIN, ownToolNames } from '../src/own'

// The test kit raises tool.check as the engine and never as the plugin under test, and refuses a
// second plugin named lumberroom-memory, so the hook's decision lives here where a test can reach it.
describe('allowsOwnCall', () => {
  test('allows the plugin its own three lumberroom tools', () => {
    for (const tool of ['context_bootstrap', 'memory_search', 'memory_write']) {
      expect(allowsOwnCall(OWN_PLUGIN, `mcp__lumberroom__${tool}`, 'lumberroom')).toBe(true)
    }
  })

  test('the plugin name is lumberroom-memory', () => {
    expect(OWN_PLUGIN).toBe('lumberroom-memory')
  })

  test('follows the server option, spelled as Claude Code spells it in a tool name', () => {
    expect(allowsOwnCall(OWN_PLUGIN, 'mcp__my_server_v2__memory_search', 'my server.v2')).toBe(true)
    expect(allowsOwnCall(OWN_PLUGIN, 'mcp__lumberroom__memory_search', 'my server.v2')).toBe(false)
  })

  test('refuses every other plugin and the engine', () => {
    for (const origin of ['other', 'engine', 'lumberroom', 'lumberroom-memory-2', '']) {
      expect(allowsOwnCall(origin, 'mcp__lumberroom__memory_write', 'lumberroom')).toBe(false)
    }
  })

  test('refuses the plugin on a tool it does not call', () => {
    for (const tool of ['mcp__lumberroom__registry_get', 'mcp__lumberroom__memory_forget', 'Bash', 'Write', 'memory_search', 'mcp__other__memory_search']) {
      expect(allowsOwnCall(OWN_PLUGIN, tool, 'lumberroom')).toBe(false)
    }
  })
})

describe('ownToolNames', () => {
  test('names the three lumberroom tools under the server name Claude Code spells', () => {
    expect([...ownToolNames('lumberroom')].sort()).toEqual([
      'mcp__lumberroom__context_bootstrap',
      'mcp__lumberroom__memory_search',
      'mcp__lumberroom__memory_write',
    ])
    expect(ownToolNames('my server.v2')).toContain('mcp__my_server_v2__memory_search')
  })
})
