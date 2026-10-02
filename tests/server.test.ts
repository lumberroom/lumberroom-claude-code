import { describe, expect, test } from 'claude-code/testing'

import { BUNDLED_SERVER, serverCandidates, toolPrefix } from '../src/server'

describe('server', () => {
  test('auto tries the bundled server, then a registered lumberroom', async () => {
    expect(serverCandidates('auto')).toEqual(['plugin:lumberroom-memory:lumberroom', 'lumberroom'])
  })

  test('a named server is the only candidate', async () => {
    expect(serverCandidates('my-lr')).toEqual(['my-lr'])
  })

  test('spells tool prefixes the way Claude Code does', async () => {
    expect(toolPrefix(BUNDLED_SERVER)).toBe('mcp__plugin_lumberroom-memory_lumberroom__')
    expect(toolPrefix('lumberroom')).toBe('mcp__lumberroom__')
  })
})
