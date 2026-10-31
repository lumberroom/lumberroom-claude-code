import { describe, expect, test } from 'claude-code/testing'

import { BUNDLED_SERVER, bundledStateFrom, isBundledName, notConnectedToast, SERVER_CANDIDATES, toolPrefix } from '../src/server'

describe('server', () => {
  test('tries the bundled server, a registered lumberroom, then the claude.ai connector by its CLI and cloud names', async () => {
    expect(SERVER_CANDIDATES).toEqual(['plugin:lumberroom-memory:lumberroom', 'lumberroom', 'claude.ai Lumberroom', 'Lumberroom'])
  })

  test('spells tool prefixes the way Claude Code does', async () => {
    expect(toolPrefix(BUNDLED_SERVER)).toBe('mcp__plugin_lumberroom-memory_lumberroom__')
    expect(toolPrefix('lumberroom')).toBe('mcp__lumberroom__')
    expect(toolPrefix('claude.ai Lumberroom')).toBe('mcp__claude_ai_Lumberroom__')
    expect(toolPrefix('Lumberroom')).toBe('mcp__Lumberroom__')
  })

  test('tells the bundled names from a connector, case and all', async () => {
    expect(isBundledName(BUNDLED_SERVER)).toBe(true)
    expect(isBundledName('lumberroom')).toBe(true)
    expect(isBundledName('Lumberroom')).toBe(false)
    expect(isBundledName('claude.ai Lumberroom')).toBe(false)
  })

  test("reads a sign-in refusal from $.mcp.connect, with the name it gives", async () => {
    expect(bundledStateFrom({ reason: 'auth', message: 'The MCP server "lumberroom" needs you to sign in; run /mcp to authenticate.' })).toEqual({ name: 'lumberroom', needsAuth: true })
    expect(bundledStateFrom({ reason: 'failed', message: 'The MCP server "plugin:lumberroom-memory:lumberroom" did not connect: ECONNREFUSED.' })).toEqual({
      name: 'plugin:lumberroom-memory:lumberroom',
      needsAuth: false,
    })
    expect(bundledStateFrom({})).toEqual({ name: BUNDLED_SERVER, needsAuth: false })
  })

  test('the no-server toast says the bundled server needs sign-in when it does', async () => {
    const toast = notConnectedToast(['plugin:lumberroom-memory:lumberroom', 'Lumberroom'], { name: 'plugin:lumberroom-memory:lumberroom', needsAuth: true })
    expect(toast).toMatch('tried "plugin:lumberroom-memory:lumberroom", "Lumberroom"')
    expect(toast).toMatch('needs sign-in')
    expect(toast).toMatch('Lumberroom connector on claude.ai')
    expect(notConnectedToast(['lumberroom'], null)).toMatch('Check /mcp.')
  })
})
