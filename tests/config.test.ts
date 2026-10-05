import { describe, expect, test } from 'claude-code/testing'

import { DEFAULTS, extrasFor, readConfig } from '../src/config'

describe('readConfig', () => {
  test('recall is off by default and on when the option says so', async () => {
    expect(DEFAULTS.recall).toBe(false)
    expect(readConfig({}).recall).toBe(false)
    expect(readConfig({ recall: true }).recall).toBe(true)
  })

  test('an empty object yields the defaults', async () => {
    expect(readConfig({})).toEqual(DEFAULTS)
  })

  test('values of the wrong type fall back to the default', async () => {
    const c = readConfig({
      recall: 'yes',
      recallLimit: '9',
      reviewInterval: Number.NaN,
      project: ['a'],
    })
    expect(c.recall).toBe(false)
    expect(c.recallLimit).toBe(6)
    expect(c.reviewInterval).toBe(8)
    expect(c.project).toBe('auto')
  })

  test('valid values pass through', async () => {
    const c = readConfig({ recall: false, recallLimit: 10, project: 'x', extractor: 'turn' })
    expect(c.recall).toBe(false)
    expect(c.recallLimit).toBe(10)
    expect(c.project).toBe('x')
    expect(c.extractor).toBe('turn')
  })

  test('numbers clamp to the manifest range', async () => {
    const hi = readConfig({
      recallLimit: 999, recallMaxChars: 99999, recallTimeoutMs: 99999,
      bootstrapTimeoutMs: 99999, digestMaxChars: 999999, reviewInterval: 1000,
    })
    expect([hi.recallLimit, hi.recallMaxChars, hi.recallTimeoutMs, hi.bootstrapTimeoutMs, hi.digestMaxChars, hi.reviewInterval])
      .toEqual([20, 16000, 8000, 8000, 30000, 100])
    const lo = readConfig({
      recallLimit: 0, recallMaxChars: 1, recallTimeoutMs: 1,
      bootstrapTimeoutMs: 1, digestMaxChars: 1, reviewInterval: -4,
    })
    expect([lo.recallLimit, lo.recallMaxChars, lo.recallTimeoutMs, lo.bootstrapTimeoutMs, lo.digestMaxChars, lo.reviewInterval])
      .toEqual([1, 500, 500, 5000, 1000, 0])
  })

  test('recallMinSimilarity defaults to 0.6 and keeps fractions', async () => {
    expect(DEFAULTS.recallMinSimilarity).toBe(0.6)
    expect(readConfig({}).recallMinSimilarity).toBe(0.6)
    expect(readConfig({ recallMinSimilarity: 0.75 }).recallMinSimilarity).toBe(0.75)
    expect(readConfig({ recallMinSimilarity: 0 }).recallMinSimilarity).toBe(0)
  })

  test('recallMinSimilarity clamps to 0..1 and a wrong type falls back', async () => {
    expect(readConfig({ recallMinSimilarity: 3 }).recallMinSimilarity).toBe(1)
    expect(readConfig({ recallMinSimilarity: -2 }).recallMinSimilarity).toBe(0)
    expect(readConfig({ recallMinSimilarity: '0.9' }).recallMinSimilarity).toBe(0.6)
    expect(readConfig({ recallMinSimilarity: Number.NaN }).recallMinSimilarity).toBe(0.6)
  })

  test('reviewInterval 0 stays 0', async () => {
    expect(readConfig({ reviewInterval: 0 }).reviewInterval).toBe(0)
  })

  test('a blank ingestToken is absent', async () => {
    expect(readConfig({ ingestToken: '   ' }).ingestToken).toBeUndefined()
    expect(readConfig({ ingestToken: '' }).ingestToken).toBeUndefined()
    expect('ingestToken' in readConfig({})).toBe(false)
  })

  test('a set ingestToken is trimmed and kept', async () => {
    expect(readConfig({ ingestToken: ' tok ' }).ingestToken).toBe('tok')
  })

  test('an extractor outside its options falls back to off', async () => {
    expect(readConfig({ extractor: 'always' }).extractor).toBe('off')
    expect(readConfig({ extractor: 3 }).extractor).toBe('off')
    expect(readConfig({ extractor: 'session-end' }).extractor).toBe('session-end')
  })

  test('blank strings fall back to the default', async () => {
    const c = readConfig({ project: '', extractorModel: ' ' })
    expect(c.project).toBe('auto')
    expect(c.extractorModel).toBe('haiku')
  })
})

describe('readConfig recallExtraProjects', () => {
  const extras = (v: unknown) => readConfig({ recallExtraProjects: v }).recallExtraProjects

  test('defaults to no extras anywhere', async () => {
    expect(DEFAULTS.recallExtraProjects).toEqual({ everywhere: [], byProject: {} })
    expect(readConfig({}).recallExtraProjects).toEqual({ everywhere: [], byProject: {} })
  })

  test('bare entries apply everywhere, split on commas and whitespace and trimmed', async () => {
    expect(extras(' lumberroom ,lumberroom-web\tfoo\nbar ')).toEqual({
      everywhere: ['lumberroom', 'lumberroom-web', 'foo', 'bar'],
      byProject: {},
    })
  })

  test('removes duplicates after slugging, keeping the first spelling order', async () => {
    expect(extras('lumberroom, Lumberroom,lumberroom,web').everywhere).toEqual(['lumberroom', 'web'])
  })

  test('runs each bare entry through the engine slug rule', async () => {
    // A path keeps its last segment, a stray character becomes a dash, and a name with no usable
    // character drops out.
    expect(extras('~/work/My_Repo,foo!bar,!!!,Café,,').everywhere).toEqual(['my_repo', 'foo-bar', 'caf'])
  })

  test('project=a+b entries apply only to that project', async () => {
    expect(extras('lumberroom-cloud=lumberroom+web')).toEqual({
      everywhere: [],
      byProject: { 'lumberroom-cloud': ['lumberroom', 'web'] },
    })
  })

  test('both sides of project=extras go through the slug rule', async () => {
    expect(extras('~/work/Lumberroom_Cloud=~/work/Lumberroom+Foo!Bar+!!!+Foo!Bar')).toEqual({
      everywhere: [],
      byProject: { lumberroom_cloud: ['lumberroom', 'foo-bar'] },
    })
  })

  test('both forms mix, and repeated project entries merge without duplicates', async () => {
    expect(extras('shared, a=x+y, b=z a=y+w')).toEqual({
      everywhere: ['shared'],
      byProject: { a: ['x', 'y', 'w'], b: ['z'] },
    })
  })

  test('drops malformed entries and keeps the valid ones around them', async () => {
    expect(extras('=x, x=, a=b=c, =, ==, a=+, a=!!!, !!!=x, ok, p=q')).toEqual({
      everywhere: ['ok'],
      byProject: { p: ['q'] },
    })
  })

  test('a project named like an object property stays plain data', async () => {
    const c = extras('__proto__=x, constructor=y')
    expect(Object.keys(c.byProject).sort()).toEqual(['__proto__', 'constructor'])
    expect(Object.getPrototypeOf(c.byProject)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  test('a blank string, a non-string and a list all yield no extras', async () => {
    const none = { everywhere: [], byProject: {} }
    expect(extras('   ')).toEqual(none)
    expect(extras(5)).toEqual(none)
    expect(extras(['a'])).toEqual(none)
  })
})

describe('extrasFor', () => {
  const config = readConfig({ recallExtraProjects: 'shared, cloud=engine+shared, other=zzz' }).recallExtraProjects

  test('returns everywhere plus the matching project entry, deduplicated', async () => {
    expect(extrasFor(config, 'cloud')).toEqual(['shared', 'engine'])
  })

  test('another project gets only the everywhere entries', async () => {
    expect(extrasFor(config, 'web')).toEqual(['shared'])
  })

  test('project none (undefined) gets only the everywhere entries', async () => {
    expect(extrasFor(config, undefined)).toEqual(['shared'])
  })

  test('drops the current slug from the result', async () => {
    const c = readConfig({ recallExtraProjects: 'cloud, cloud=engine+cloud' }).recallExtraProjects
    expect(extrasFor(c, 'cloud')).toEqual(['engine'])
  })

  test('a current slug named like an object property finds nothing', async () => {
    expect(extrasFor(config, 'constructor')).toEqual(['shared'])
    expect(extrasFor(config, 'toString')).toEqual(['shared'])
  })
})
