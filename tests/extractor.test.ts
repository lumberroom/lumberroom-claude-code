import { describe, expect, test } from 'claude-code/testing'

import {
  EXTRACT_MAX_FACTS,
  EXTRACT_MAX_INPUT_CHARS,
  buildExtractPrompt,
  buildJudgePrompt,
  parseFacts,
  parseJudge,
  stripRecall,
  turnsFrom,
  type Turn,
} from '../src/extractor'

const line = (content: string, namespace = 'global', tags?: unknown) => JSON.stringify({ content, namespace, tags })

describe('buildExtractPrompt', () => {
  test('lists the allowed namespaces with the project one', async () => {
    const p = buildExtractPrompt([{ role: 'user', text: 'hello' }], 'lumberroom-cloud')
    expect(p).toContain('user:me')
    expect(p).toContain('global')
    expect(p).toContain('project:lumberroom-cloud')
    expect(p).toContain('NONE')
  })
  test('omits the project namespace when none is given', async () => {
    const p = buildExtractPrompt([{ role: 'user', text: 'hello' }], null)
    expect(p).not.toContain('project:')
  })
  test('keeps the newest turns when the input is over the cap', async () => {
    const big = 'x'.repeat(EXTRACT_MAX_INPUT_CHARS / 2 + 100)
    const turns: Turn[] = [
      { role: 'user', text: `OLDEST ${big}` },
      { role: 'assistant', text: `MIDDLE ${big}` },
      { role: 'user', text: 'NEWEST question' },
    ]
    const p = buildExtractPrompt(turns, null)
    expect(p).toContain('NEWEST question')
    expect(p).not.toContain('OLDEST')
  })
  test('keeps everything when under the cap', async () => {
    const p = buildExtractPrompt([{ role: 'user', text: 'first' }, { role: 'assistant', text: 'second' }], null)
    expect(p).toContain('first')
    expect(p).toContain('second')
  })
})

describe('parseFacts', () => {
  test('reads JSON lines', async () => {
    const got = parseFacts(`${line('Port is 8443', 'global', ['infra'])}\n${line('Prefers tabs', 'user:me')}`, null)
    expect(got).toEqual([
      { content: 'Port is 8443', namespace: 'global', tags: ['infra'] },
      { content: 'Prefers tabs', namespace: 'user:me' },
    ])
  })
  test('reads lines inside a json fence', async () => {
    const got = parseFacts('```json\n' + line('A fact') + '\n```', null)
    expect(got.map((f) => f.content)).toEqual(['A fact'])
  })
  test('ignores prose around the lines', async () => {
    const got = parseFacts(`Here are the facts:\n${line('One')}\nHope that helps.`, null)
    expect(got.map((f) => f.content)).toEqual(['One'])
  })
  test('NONE yields nothing', async () => {
    expect(parseFacts('NONE', null)).toEqual([])
    expect(parseFacts('', null)).toEqual([])
  })
  test('drops a disallowed namespace', async () => {
    expect(parseFacts(line('x', 'team:other'), null)).toEqual([])
  })
  test('allows the project namespace only when project is given', async () => {
    const text = line('x', 'project:lr')
    expect(parseFacts(text, null)).toEqual([])
    expect(parseFacts(text, 'other')).toEqual([])
    expect(parseFacts(text, 'lr').length).toBe(1)
  })
  test('drops empty and non-string content and keeps only string tags arrays', async () => {
    const text = [line(''), line('   '), JSON.stringify({ content: 5, namespace: 'global' }), line('ok', 'global', 'nope'), line('ok2', 'global', ['a', 1])].join('\n')
    expect(parseFacts(text, null)).toEqual([{ content: 'ok', namespace: 'global' }, { content: 'ok2', namespace: 'global' }])
  })
  test('caps the result at the fact limit', async () => {
    const text = Array.from({ length: EXTRACT_MAX_FACTS + 5 }, (_, i) => line(`fact ${i}`)).join('\n')
    expect(parseFacts(text, null).length).toBe(EXTRACT_MAX_FACTS)
  })
  test('skips a malformed line and keeps the next', async () => {
    expect(parseFacts(`{not json\n${line('good')}`, null).map((f) => f.content)).toEqual(['good'])
  })
  for (const [name, secret] of [
    ['an lr_ token', 'The token is lr_abcdef1234567890abcdef'],
    ['a private key block', '-----BEGIN PRIVATE KEY-----\nMIIE'],
    ['an RSA private key block', '-----BEGIN RSA PRIVATE KEY----- abc'],
    ['an AWS key id', 'deploy key AKIAIOSFODNN7EXAMPLE for staging'],
    ['a password assignment', 'db password=hunter2 on prod'],
    ['a token assignment', 'use token=abc123def'],
  ] as const) {
    test(`drops content with ${name}`, async () => {
      expect(parseFacts(`${line(secret)}\n${line('clean fact')}`, null).map((f) => f.content)).toEqual(['clean fact'])
    })
  }
  // Shapes of the engine's tripwire (ENG src/domain/tripwire.rs). Built at run time so no literal
  // here reads as a live key to a secret scanner.
  const tail = (n: number) => 'aB3dE5gH7jK9mN1pQ3rS5tU7vW9xY1zA3bC5dE7fG9'.repeat(3).slice(0, n)
  for (const [name, secret] of [
    ['a GitHub token', `the token ghp_${tail(36)} for CI`],
    ['a GitHub fine-grained token', `use github_pat_${tail(82)} here`],
    ['an OpenAI key', `key sk-${tail(32)} in env`],
    ['an Anthropic key', `key sk-ant-${tail(40)} in env`],
    ['a Slack bot token', `bot xoxb-${tail(30)}`],
    ['a Slack user token', `user xoxp-${tail(30)}`],
    ['a GitLab token', `gitlab glpat-${tail(24)}`],
    ['a postgres URL with a password', 'database at postgres://admin:s3cretpw@db.internal:5432/app'],
    ['a mongodb URL with a password', 'mongodb+srv://svc:pa55word@cluster0.example.net/db'],
  ] as const) {
    test(`drops content with ${name}`, async () => {
      expect(parseFacts(`${line(secret)}\n${line('clean fact')}`, null).map((f) => f.content)).toEqual(['clean fact'])
    })
  }
  for (const [name, text] of [
    ['a prose mention of the sk- prefix', 'API keys from that vendor start with sk- and are long'],
    ['a connection string with a placeholder password', 'set DATABASE_URL to postgres://admin:${DB_PASS}@db.internal/app'],
    ['a connection string with no password', 'postgres://db.internal:5432/app is the primary'],
    ['a short sk- token', 'sk-short is a branch name'],
    ['a prefix inside a longer word', 'the task-ghp_ prefix stays'],
  ] as const) {
    test(`keeps ${name}`, async () => {
      expect(parseFacts(line(text), null).length).toBe(1)
    })
  }
  test('keeps content that mentions passwords without a value', async () => {
    expect(parseFacts(line('Passwords live in the vault'), null).length).toBe(1)
  })
})

describe('buildJudgePrompt', () => {
  test('contains both contents and asks for YES or NO', async () => {
    const p = buildJudgePrompt(
      { content: 'Port is 9000', namespace: 'global' },
      { id: 'i', namespace: 'global', content: 'Port is 8443' },
    )
    expect(p).toContain('Port is 9000')
    expect(p).toContain('Port is 8443')
    expect(p).toContain('YES')
    expect(p).toContain('NO')
  })
})

describe('parseJudge', () => {
  test('accepts YES in any case with punctuation', async () => {
    expect(parseJudge('YES')).toBe(true)
    expect(parseJudge('yes.')).toBe(true)
    expect(parseJudge('  Yes, it is the older one')).toBe(true)
  })
  test('rejects NO, empty and other words', async () => {
    expect(parseJudge('No')).toBe(false)
    expect(parseJudge('')).toBe(false)
    expect(parseJudge('Maybe yes')).toBe(false)
    expect(parseJudge('yesterday')).toBe(false)
  })
})

describe('stripRecall', () => {
  const BLOCK = '<lumberroom-recall>\nRetrieved from lumberroom for this message.\n- [user:me] a fact (id x)\n</lumberroom-recall>'
  test('removes a whole block', async () => {
    expect(stripRecall(BLOCK)).toBe('')
  })
  test('keeps the text around a block in the same message', async () => {
    expect(stripRecall(`before\n${BLOCK}\nafter`).replace(/\s+/g, ' ').trim()).toBe('before after')
  })
  test('removes a block inside an empty wrapper tag', async () => {
    expect(stripRecall(`<system-reminder>\n${BLOCK}\n</system-reminder>`).trim()).toBe('')
  })
  test('removes two blocks and any case of the tag', async () => {
    const upper = BLOCK.replace(/lumberroom-recall/g, 'LUMBERROOM-RECALL')
    expect(stripRecall(`${BLOCK} mid ${upper}`).trim()).toBe('mid')
  })
  test('removes an unclosed block through the end of the text', async () => {
    expect(stripRecall('ask <lumberroom-recall>\n- a fact').trim()).toBe('ask')
  })
  test('leaves text with no block alone', async () => {
    expect(stripRecall('we ship on pnpm')).toBe('we ship on pnpm')
  })
})

describe('turnsFrom', () => {
  const BLOCK = '<lumberroom-recall>\n- [user:me] secret-ish fact\n</lumberroom-recall>'
  test('drops a row that is only a recall block and keeps the rest in order', async () => {
    const turns = turnsFrom([
      { role: 'user', text: 'how do I build?' },
      { role: 'user', text: BLOCK },
      { role: 'assistant', text: 'use pnpm' },
    ])
    expect(turns).toEqual([
      { role: 'user', text: 'how do I build?' },
      { role: 'assistant', text: 'use pnpm' },
    ])
  })
  test('keeps the typed part of a message that also carried a block', async () => {
    const turns = turnsFrom([{ role: 'user', text: `how do I build?\n${BLOCK}` }])
    expect(turns).toHaveLength(1)
    expect(turns[0]?.text).toBe('how do I build?')
  })
  test('drops empty messages', async () => {
    expect(turnsFrom([{ role: 'assistant', text: '  ' }])).toEqual([])
  })
  test('no prompt built from the turns carries the recall tag', async () => {
    const prompt = buildExtractPrompt(turnsFrom([{ role: 'user', text: `q\n${BLOCK}` }, { role: 'user', text: BLOCK }]), null)
    expect(prompt).not.toContain('lumberroom-recall')
    expect(prompt).not.toContain('secret-ish fact')
  })
})
