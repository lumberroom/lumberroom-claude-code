import type { Register } from 'claude-code'

// Throwaway probe for spec questions (a) and (b). Logs to /tmp/lr-probe.
const OUT = '/tmp/lr-probe'

export const register: Register = (on) => {
  const steps: unknown[] = []
  let turn = 0

  on('session.start', async ($, e, next) => {
    const res = await next(e)
    const shape: Record<string, unknown> = {}
    for (const tool of ['memory_search', 'context_bootstrap'] as const) {
      try {
        const args = tool === 'memory_search' ? { query: 'lumberroom claude code mod probe', limit: 2 } : { project: 'lumberroom' }
        const r = await $.mcp.call('lumberroom', tool, args)
        const sc = r.structuredContent as Record<string, unknown> | undefined
        shape[tool] = {
          isError: r.isError,
          contentTypes: r.content.map((b) => b.type),
          textHead: r.content[0]?.text?.slice(0, 300),
          hasStructured: sc !== undefined,
          structuredKeys: sc ? Object.keys(sc) : null,
          firstHitKeys: Array.isArray(sc?.hits) && sc.hits.length ? Object.keys(sc.hits[0] as object) : null,
        }
      } catch (err) {
        shape[tool] = { threw: String(err) }
      }
    }
    await $.fs.write(`${OUT}/mcp-shape.json`, JSON.stringify(shape, null, 2))
    return res
  })

  on('prompt.submit', ($, e, next) => {
    turn = Number(/turn (\d+)/.exec(e.text)?.[1] ?? turn + 1)
    if (!e.text.includes('[CTX]')) return next(e)
    const marker = `LRPROBE-T${turn}-`
    const filler = (marker + 'lorem ipsum dolor sit amet '.repeat(150)).slice(0, 4000)
    return next({ ...e, context: [...(e.context ?? []), filler] })
  })

  on('tool.check', async ($, e, next) => {
    const origin = (next as unknown as { origin?: { plugin?: string } }).origin
    await $.fs.write(`${OUT}/check-${e.tool}.json`, JSON.stringify({ tool: e.tool, origin }, null, 1))
    if (origin?.plugin === 'lr-probe' && e.tool.startsWith('mcp__lumberroom__')) return { decision: 'allow', reason: 'lr-probe reads its own memory' }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    await $.fs.write(`${OUT}/compose.json`, JSON.stringify({ traits: e.traits, sections: res.sections.map((x) => ({ id: x.id, scope: x.scope, len: x.text.length })) }, null, 1))
    return res
  })

  const sectionNames: Record<string, number | null> = {}
  on('prompt.section', async ($, e, next) => {
    const res = await next(e)
    sectionNames[e.name] = res.text === null ? null : res.text.length
    if (e.name === 'memory' && res.text) await $.fs.write(`${OUT}/memory-section.txt`, res.text)
    await $.fs.write(`${OUT}/section-names.json`, JSON.stringify(sectionNames, null, 1))
    return res
  })

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    const u = res.usage
    steps.push({ turn, index: e.index, input: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : null, usage: u })
    const prev = await $.fs.read(`${OUT}/steps.json`).then((t) => JSON.parse(t) as unknown[]).catch(() => [])
    await $.fs.write(`${OUT}/steps.json`, JSON.stringify([...prev, steps.at(-1)], null, 1))
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    const api = await $.session.messages({ as: 'api' })
    const raw = JSON.stringify(api)
    const markers = raw.match(/LRPROBE-T\d+-/g) ?? []
    await $.fs.write(`${OUT}/history-t${turn}.json`, JSON.stringify({ turn, messages: (api as unknown[]).length, markerCounts: markers.reduce((m: Record<string, number>, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}) }, null, 1))
    return res
  })
}
