// The system-prompt section: the write rule and the engine's digest, and the check that keeps the
// CLAUDE.md block from doubling the rule (spec 5).

import { isBundledName, toolPrefix } from './server'
import type { BundledState } from './server'

export const SECTION_ID = 'lumberroom-memory:memory'
export const DIGEST_HEADING = '# Durable memory (lumberroom)'

/** ENG client/CLAUDE.md.snippet without its markers and its own heading. Keep in step with it. */
export const WRITE_RULE = `You have a shared memory service (MCP server \`lumberroom\`) that persists across sessions, machines,
and clients. It is the same store every one of this user's agents reads and writes.

**Read.** This section already carries a memory digest. When a task depends on a past
decision, a preference, a host, a credential location, or "how do we usually do this", call
\`memory_search\` before asking the user or assuming. Call \`registry_get\` for exact operational
values (hosts, service endpoints, where a credential lives).

**Write.** After any exchange that establishes a decision, a preference, a constraint, or a
durable fact, call \`memory_write\`. Without asking. Without announcing it. One fact per call,
phrased so it stands alone in six months, carrying the numbers, identifiers, paths and dates the
fact needs, and the cause, scope qualifier and reversal condition whenever the fact turns on them.
Cut the trail of how you came to believe it: the search you ran, the file you read on the way, the
argument for the claim. No hedges, no evaluative words, no restated context, no inventory of what
you left unchanged. A list or a timeline runs long and that is right; prose about a short fact
runs long and that is bloat. Two facts from one exchange are two calls.

- \`user:me\`: facts about this user and how they work
- \`project:<slug>\`: facts scoped to one codebase
- \`global\`: facts true everywhere: infrastructure, conventions, credential locations

Do not write transient chatter, file contents, secrets, or anything you would not want repeated
back next month.`

/** The tools the model calls itself; the section names them with the live server's prefix. */
const MODEL_TOOLS = ['memory_search', 'memory_write', 'registry_get'] as const

/**
 * Which server answered and how its tools are spelled, so the model calls the live one. WRITE_RULE
 * keeps the snippet's `lumberroom`, which is the wrong name under a connector. A claude.ai
 * connector's tools are often deferred, so the note names the ToolSearch load. When the
 * connector answered while the bundled server waits for sign-in, it says that entry is harmless:
 * Claude Code lists it as needing authentication and the model would otherwise report lumberroom
 * as broken. "" with no server.
 */
export function serverNote(server: string | null | undefined, bundled?: BundledState | null): string {
  if (!server) return ''
  const prefix = toolPrefix(server)
  const tools = MODEL_TOOLS.map((t) => `\`${prefix}${t}\``).join(', ')
  const lines = [
    `In this session lumberroom answers on the MCP server \`${server}\`: call its tools as ${tools} (prefix \`${prefix}*\`). If they are not in your tool list yet, they are deferred: load them first with ToolSearch, query \`select:${MODEL_TOOLS.map((t) => prefix + t).join(',')}\`.`,
  ]
  if (bundled?.needsAuth === true && !isBundledName(server) && bundled.name !== server) {
    lines.push(
      `The MCP server \`${bundled.name}\` may be listed as needing authentication. That is the plugin's bundled copy of the same engine and is harmless while \`${server}\` answers: memory works, so do not tell the user lumberroom is broken or ask them to sign in.`,
    )
  }
  return lines.join('\n')
}

/**
 * context_bootstrap's parsed data -> { text, memories }. `text` is data.text when a string, else
 * data itself when a string (an engine that answered markdown), else "". `memories` is
 * data.counts.memories when a number.
 */
export function digestFrom(data: unknown): { text: string; memories: number | null } {
  if (typeof data === 'string') return { text: data, memories: null }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { text: '', memories: null }
  const obj = data as { text?: unknown; counts?: unknown }
  const text = typeof obj.text === 'string' ? obj.text : ''
  const counts = obj.counts
  const memories =
    typeof counts === 'object' && counts !== null && typeof (counts as { memories?: unknown }).memories === 'number'
      ? (counts as { memories: number }).memories
      : null
  return { text, memories }
}

/**
 * The section text: DIGEST_HEADING, the project line when `project`, the server note when
 * `server`, WRITE_RULE when `includeRule`, then the digest clipped so the whole section fits
 * `maxChars`, cut at the last whole line. "" when there is no digest and no rule.
 */
export function buildSection(
  digest: string,
  opts: { includeRule: boolean; maxChars: number; project: string | null; server?: string | null; bundled?: BundledState | null },
): string {
  const body = digest.trim()
  if (body === '' && !opts.includeRule) return ''
  const parts = [DIGEST_HEADING]
  if (opts.project) parts.push(`Project: ${opts.project}`)
  const note = serverNote(opts.server, opts.bundled)
  if (note !== '') parts.push(note)
  if (opts.includeRule) parts.push(WRITE_RULE)
  const prefix = parts.join('\n\n')
  const room = opts.maxChars - prefix.length - 2
  if (body === '' || room <= 0) return opts.includeRule ? prefix : ''
  let clipped = body
  if (body.length > room) {
    // Cut at a newline so a fact is never sent half-written; a digest line that alone exceeds
    // the room is dropped whole.
    const cut = body.lastIndexOf('\n', room)
    clipped = cut > 0 ? body.slice(0, cut).trimEnd() : ''
  }
  if (clipped === '') return opts.includeRule ? prefix : ''
  return `${prefix}\n\n${clipped}`
}

/** True when a CLAUDE.md holds a `# Durable memory` heading and names memory_write after it. */
export function hasDurableMemoryBlock(claudeMd: string): boolean {
  const heading = /^# Durable memory\b.*$/m.exec(claudeMd)
  if (!heading) return false
  return claudeMd.slice(heading.index + heading[0].length).includes('memory_write')
}
