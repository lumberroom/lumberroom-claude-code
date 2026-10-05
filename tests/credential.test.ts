import { describe, expect, test } from 'claude-code/testing'

import { cliConfigPath, DEFAULT_ENGINE, engineBase, resolveIngest } from '../src/credential'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const LATER = '2026-10-05T13:00:00Z'
const EARLIER = '2026-10-05T11:00:00Z'
const cli = (v: unknown): string => JSON.stringify(v)

describe('resolveIngest', () => {
  test('nothing anywhere is none', async () => {
    expect(resolveIngest({ cliConfig: '', now: NOW })).toEqual({ ok: false, reason: 'none' })
    expect(resolveIngest({ cliConfig: 'not json', now: NOW })).toEqual({ ok: false, reason: 'none' })
  })

  test('the option beats the environment, which beats the CLI file', async () => {
    const file = cli({ token: 'file', oauth: { access_token: 'oa', expires_at: LATER } })
    const all = { optionToken: 'opt', envToken: 'env', cliConfig: file, now: NOW }
    expect(resolveIngest(all)).toMatchObject({ ok: true, credential: { token: 'opt', source: 'option' } })
    expect(resolveIngest({ ...all, optionToken: ' ' })).toMatchObject({ ok: true, credential: { token: 'env', source: 'env' } })
    expect(resolveIngest({ ...all, optionToken: undefined, envToken: '' })).toMatchObject({ ok: true, credential: { token: 'file', source: 'cli-token' } })
  })

  test('the CLI OAuth token is used until it expires', async () => {
    expect(resolveIngest({ cliConfig: cli({ oauth: { access_token: 'oa', expires_at: LATER } }), now: NOW })).toMatchObject({
      ok: true,
      credential: { token: 'oa', source: 'cli-oauth' },
    })
    expect(resolveIngest({ cliConfig: cli({ oauth: { access_token: 'oa', expires_at: EARLIER } }), now: NOW })).toEqual({ ok: false, reason: 'expired' })
    // No expiry recorded: the token goes out and the engine decides.
    expect(resolveIngest({ cliConfig: cli({ oauth: { access_token: 'oa' } }), now: NOW })).toMatchObject({ ok: true })
  })

  test('the engine is LUMBERROOM_URL, then the CLI url, then lumberroom.cloud, without /mcp', async () => {
    const file = cli({ url: 'https://file.example/mcp', token: 't' })
    expect(resolveIngest({ envUrl: 'https://env.example/', cliConfig: file, now: NOW })).toMatchObject({ credential: { baseUrl: 'https://env.example' } })
    expect(resolveIngest({ cliConfig: file, now: NOW })).toMatchObject({ credential: { baseUrl: 'https://file.example' } })
    expect(resolveIngest({ optionToken: 't', cliConfig: '', now: NOW })).toMatchObject({ credential: { baseUrl: DEFAULT_ENGINE } })
  })
})

describe('helpers', () => {
  test('engineBase strips trailing slashes and /mcp', async () => {
    expect(engineBase('https://x.test/mcp/')).toBe('https://x.test')
    expect(engineBase('https://x.test///')).toBe('https://x.test')
  })

  test('cliConfigPath honours LUMBERROOM_CONFIG', async () => {
    expect(cliConfigPath(undefined, '/home/u')).toBe('/home/u/.config/lumberroom/config.json')
    expect(cliConfigPath(' ', '/home/u')).toBe('/home/u/.config/lumberroom/config.json')
    expect(cliConfigPath('/tmp/lr.json', '/home/u')).toBe('/tmp/lr.json')
  })
})
