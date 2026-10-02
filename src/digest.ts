// The system-prompt section: the write rule and the engine's digest. Also the two pieces that keep
// the old SessionStart shell hook and the CLAUDE.md block from doubling it (spec 5).

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

/** The first line of the old shell hook's block (ENG crates/lumberroom bootstrap --hook). */
export const OLD_HOOK_OPENING = 'Durable memory for this user, retrieved automatically at session start'
export const OLD_HOOK_TRUNCATION_END = 'use memory_search for the rest)_'

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
 * The section text: DIGEST_HEADING, the project line when `project`, WRITE_RULE when
 * `includeRule`, then the digest clipped so the whole section fits `maxChars`, cut at the last
 * whole line. "" when there is no digest and no rule.
 */
export function buildSection(digest: string, opts: { includeRule: boolean; maxChars: number; project: string | null }): string {
  const body = digest.trim()
  if (body === '' && !opts.includeRule) return ''
  const parts = [DIGEST_HEADING]
  if (opts.project) parts.push(`Project: ${opts.project}`)
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

// Lines the hook's digest can contain. A non-blank line outside this set after a blank line is
// another hook's text, so the block ends before the blank line.
function isDigestSyntax(line: string): boolean {
  return (
    line.startsWith('-') ||
    line.startsWith('#') ||
    line.startsWith('Store:') ||
    line.startsWith('Active project') ||
    line.startsWith('_(') ||
    /^\s/.test(line)
  )
}

/**
 * Cuts the old shell hook's block out of a SessionStart additionalContext. The block runs from
 * OLD_HOOK_OPENING to the end of OLD_HOOK_TRUNCATION_END when that comes first, else to the first
 * blank line followed by a line that is not digest syntax (not starting with `-`, `#`, `Store:`,
 * `Active project`, `_(` or whitespace), else to the end. Blank lines left at the seam collapse to
 * one. With no opening line the text comes back untouched and `stripped` is false.
 */
export function stripOldHookBlock(additionalContext: string): { text: string; stripped: boolean } {
  const start = additionalContext.indexOf(OLD_HOOK_OPENING)
  if (start < 0) return { text: additionalContext, stripped: false }

  let end = additionalContext.length
  const trunc = additionalContext.indexOf(OLD_HOOK_TRUNCATION_END, start)
  if (trunc >= 0) end = trunc + OLD_HOOK_TRUNCATION_END.length

  // Walk line by line from the opening; stop at a blank line that precedes foreign text.
  const lines = additionalContext.slice(start, end).split('\n')
  let offset = start
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (line.trim() === '') {
      let j = i + 1
      while (j < lines.length && (lines[j] as string).trim() === '') j++
      if (j < lines.length && !isDigestSyntax(lines[j] as string)) {
        end = offset
        break
      }
    }
    offset += line.length + 1
  }

  const before = additionalContext.slice(0, start).trimEnd()
  const after = additionalContext.slice(end).trim()
  const text = before !== '' && after !== '' ? `${before}\n\n${after}` : before !== '' ? before : after
  return { text, stripped: true }
}

/** True when a CLAUDE.md holds a `# Durable memory` heading and names memory_write after it. */
export function hasDurableMemoryBlock(claudeMd: string): boolean {
  const heading = /^# Durable memory\b.*$/m.exec(claudeMd)
  if (!heading) return false
  return claudeMd.slice(heading.index + heading[0].length).includes('memory_write')
}
