import { describe, expect, test } from 'claude-code/testing'

import { afterContextReset, estimateTokens, formatStatus, isServerTool, NO_COST } from '../src/cost'

describe('cost', () => {
  test('estimates four characters a token, rounding up', async () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  test('matches only the configured server tools', async () => {
    expect(isServerTool('mcp__lumberroom__memory_search', 'lumberroom')).toBe(true)
    expect(isServerTool('mcp__lumberroom2__memory_search', 'lumberroom')).toBe(false)
    expect(isServerTool('Read', 'lumberroom')).toBe(false)
  })

  test('a context reset keeps the section and clears the rest', async () => {
    expect(afterContextReset({ section: 2000, blocks: 90, tools: 400, toolCalls: 2 })).toEqual({ ...NO_COST, section: 2000 })
  })

  test('formats the total and each part', async () => {
    expect(formatStatus({ section: 2010, blocks: 30, tools: 400, toolCalls: 1 })).toBe('lumberroom ~2.4k tokens in context: digest 2.0k, reminders 30, tools 400 (1 call)')
    expect(formatStatus(NO_COST)).toBe('lumberroom ~0 tokens in context: digest 0, reminders 0, tools 0 (0 calls)')
  })
})
