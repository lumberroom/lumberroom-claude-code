import { describe, expect, test } from 'claude-code/testing'

import { SNAPSHOT } from './fixtures/tools-snapshot'

/** Every engine call the plugin makes and the argument names it sends. Extend it with the code. */
export const PLUGIN_CALLS: Record<string, readonly string[]> = {
  context_bootstrap: ['project'],
  memory_search: ['query', 'namespaces', 'limit', 'project'],
  memory_write: ['content', 'namespace', 'tags', 'supersedes'],
  review_queue: ['source', 'limit'],
  review_decide: ['key', 'verdict', 'version', 'reason'],
}

const tools = SNAPSHOT.tools as Record<string, { properties: readonly string[]; required: readonly string[] }>

describe('engine tool drift', () => {
  for (const [name, sent] of Object.entries(PLUGIN_CALLS)) {
    test(`${name} exists in the snapshot`, async () => {
      expect(name in tools).toBe(true)
    })
    test(`${name} sends only arguments its schema declares`, async () => {
      const declared = tools[name]?.properties ?? []
      expect(sent.filter((a) => !declared.includes(a))).toEqual([])
    })
    test(`${name} sends every required argument`, async () => {
      const required = tools[name]?.required ?? []
      expect(required.filter((r) => !sent.includes(r))).toEqual([])
    })
  }
})
