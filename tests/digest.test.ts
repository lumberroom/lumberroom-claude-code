import { describe, expect, test } from 'claude-code/testing'

import {
  DIGEST_HEADING,
  WRITE_RULE,
  buildSection,
  digestFrom,
  hasDurableMemoryBlock,
} from '../src/digest'

describe('digestFrom', () => {
  test('reads text and the memory count from a parsed object', () => {
    expect(digestFrom({ text: '- a fact', counts: { memories: 42 } })).toEqual({ text: '- a fact', memories: 42 })
  })

  test('takes a bare string as the digest with no count', () => {
    expect(digestFrom('## Memory digest\n- a fact')).toEqual({ text: '## Memory digest\n- a fact', memories: null })
  })

  test('returns an empty digest for junk', () => {
    expect(digestFrom(null)).toEqual({ text: '', memories: null })
    expect(digestFrom(7)).toEqual({ text: '', memories: null })
    expect(digestFrom([1, 2])).toEqual({ text: '', memories: null })
    expect(digestFrom({ text: 5, counts: { memories: '3' } })).toEqual({ text: '', memories: null })
  })

  test('keeps the count when the object carries no text', () => {
    expect(digestFrom({ counts: { memories: 3 } })).toEqual({ text: '', memories: 3 })
  })
})

describe('buildSection', () => {
  const digest = ['## Memory digest', '- first fact', '- second fact', '- third fact'].join('\n')

  test('puts heading, project line, rule and digest in that order', () => {
    const out = buildSection(digest, { includeRule: true, maxChars: 8000, project: 'demo-app' })
    expect(out.startsWith(DIGEST_HEADING)).toBe(true)
    const project = out.indexOf('demo-app')
    const rule = out.indexOf(WRITE_RULE)
    const body = out.indexOf('- first fact')
    expect(project > 0).toBe(true)
    expect(rule > project).toBe(true)
    expect(body > rule).toBe(true)
  })

  test('omits the rule when includeRule is false', () => {
    const out = buildSection(digest, { includeRule: false, maxChars: 8000, project: null })
    expect(out.includes(WRITE_RULE)).toBe(false)
    expect(out.includes('- first fact')).toBe(true)
  })

  test('leaves out the project line when there is no project', () => {
    const out = buildSection(digest, { includeRule: false, maxChars: 8000, project: null })
    expect(out.toLowerCase().includes('project:')).toBe(false)
  })

  test('returns an empty string with no digest and no rule', () => {
    expect(buildSection('', { includeRule: false, maxChars: 8000, project: 'demo-app' })).toBe('')
    expect(buildSection('  \n ', { includeRule: false, maxChars: 8000, project: null })).toBe('')
  })

  test('keeps the rule alone when the digest is empty', () => {
    const out = buildSection('', { includeRule: true, maxChars: 8000, project: null })
    expect(out.includes(WRITE_RULE)).toBe(true)
  })

  test('clips the digest at the last whole line inside maxChars', () => {
    const full = buildSection(digest, { includeRule: false, maxChars: 8000, project: null })
    const secondEnd = full.indexOf('- second fact') + '- second fact'.length
    const out = buildSection(digest, { includeRule: false, maxChars: secondEnd + 5, project: null })
    expect(out.includes('- second fact')).toBe(true)
    expect(out.includes('- third')).toBe(false)
    expect(out.length <= secondEnd + 5).toBe(true)
  })

  test('counts the heading and the rule against maxChars', () => {
    const out = buildSection(digest, { includeRule: true, maxChars: WRITE_RULE.length + 200, project: 'demo-app' })
    expect(out.length <= WRITE_RULE.length + 200).toBe(true)
    expect(out.includes(WRITE_RULE)).toBe(true)
  })

  test('drops a digest whose first line alone does not fit', () => {
    const out = buildSection('x'.repeat(500), { includeRule: true, maxChars: WRITE_RULE.length + 100, project: null })
    expect(out.includes('xxxx')).toBe(false)
    expect(out.includes(WRITE_RULE)).toBe(true)
  })
})

describe('hasDurableMemoryBlock', () => {
  const SNIPPET = `<!-- lumberroom:begin -->
# Durable memory

You have a shared memory service. Call \`memory_write\` after every decision.
<!-- lumberroom:end -->`

  test('is true for the snippet', () => {
    expect(hasDurableMemoryBlock(`# Notes\n\nsome text\n\n${SNIPPET}\n`)).toBe(true)
  })

  test('is false for a CLAUDE.md without the heading', () => {
    expect(hasDurableMemoryBlock('# Notes\n\nUse tabs.\n')).toBe(false)
  })

  test('is false when memory_write appears with no such heading', () => {
    expect(hasDurableMemoryBlock('# Tools\n\nCall memory_write when asked.\n')).toBe(false)
  })

  test('is false when memory_write only appears before the heading', () => {
    expect(hasDurableMemoryBlock('Call memory_write sometimes.\n\n# Durable memory\n\nNothing else here.\n')).toBe(false)
  })

  test('is false for the heading as a sub-heading', () => {
    expect(hasDurableMemoryBlock('## Durable memory\n\nmemory_write\n')).toBe(false)
  })
})
