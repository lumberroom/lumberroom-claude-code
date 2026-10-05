import { describe, expect, test } from 'claude-code/testing'

import { BUNDLED_SERVER, SERVER_CANDIDATES, toolPrefix } from '../src/server'

describe('server', () => {
  test('tries the bundled server, then a registered lumberroom', async () => {
    expect(SERVER_CANDIDATES).toEqual(['plugin:lumberroom-memory:lumberroom', 'lumberroom'])
  })

  test('spells tool prefixes the way Claude Code does', async () => {
    expect(toolPrefix(BUNDLED_SERVER)).toBe('mcp__plugin_lumberroom-memory_lumberroom__')
    expect(toolPrefix('lumberroom')).toBe('mcp__lumberroom__')
  })
})
