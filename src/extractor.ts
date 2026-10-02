// The optional extractor's prompts and parsers. Pure text in, text out; register.ts runs the model.

import type { Conflict, Fact } from './writes'

/** One message as $.session.messages() answers it, reduced to what the prompt reads. */
export interface Turn {
  role: 'user' | 'assistant'
  text: string
}

/** The recall block and its tags, as src/recall.ts writes them. */
const RECALL_BLOCK = /<lumberroom-recall>[\s\S]*?<\/lumberroom-recall>/gi
const RECALL_UNCLOSED = /<lumberroom-recall>[\s\S]*$/i
const RECALL_STRAY_CLOSE = /<\/lumberroom-recall>/gi
const EMPTY_WRAPPER = /<([A-Za-z][\w-]*)>\s*<\/\1>/g

/**
 * Text with every `<lumberroom-recall>` block cut out. The plugin attaches that block as a hidden
 * user row, so `$.session.messages()` hands it back as something the person said, and an
 * extractor that reads it would write recalled memories back as new facts.
 */
export function stripRecall(text: string): string {
  return text.replace(RECALL_BLOCK, '').replace(RECALL_UNCLOSED, '').replace(RECALL_STRAY_CLOSE, '').replace(EMPTY_WRAPPER, '')
}

/** Messages -> turns: recall blocks removed, rows left empty dropped. */
export function turnsFrom(messages: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>): Turn[] {
  const turns: Turn[] = []
  for (const m of messages) {
    const text = stripRecall(m.text).trim()
    if (text !== '') turns.push({ role: m.role, text })
  }
  return turns
}

export const EXTRACT_MAX_INPUT_CHARS = 24_000
export const EXTRACT_MAX_FACTS = 10

/**
 * The prompt for $.model.complete. It carries the write rule's standards (one fact per line,
 * standalone, identifiers and dates kept, no chatter, no secrets, no file contents), the
 * namespaces allowed (`user:me`, `global`, `project:<slug>` when `project`), and the turns, newest
 * kept when they overflow EXTRACT_MAX_INPUT_CHARS. It asks for JSON Lines of
 * {"content","namespace","tags"} and the single word NONE when nothing qualifies.
 */
export function buildExtractPrompt(turns: readonly Turn[], project: string | null): string {
  const namespaces = allowedNamespaces(project)
  const label = (t: Turn) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`
  // Walk from the newest turn back: recent turns hold the facts not yet stored.
  const kept: string[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const entry = label(turns[i] as Turn)
    const room = EXTRACT_MAX_INPUT_CHARS - used
    if (entry.length <= room) {
      kept.unshift(entry)
      used += entry.length + 2
    } else {
      // A single turn over the cap keeps its tail only when nothing newer was kept.
      if (kept.length === 0) kept.unshift(entry.slice(entry.length - EXTRACT_MAX_INPUT_CHARS))
      break
    }
  }
  return [
    'You extract durable facts from a conversation for a long-term memory store.',
    'Write a fact only for a decision, preference, constraint or durable technical fact the conversation established.',
    'Each fact stands alone and makes sense in six months: name the subject and keep numbers, identifiers, paths and dates.',
    'One fact per line. No chatter, no restated context, no secrets or credentials, no file contents.',
    '',
    `Allowed namespaces: ${namespaces.join(', ')}.`,
    'Answer in JSON Lines, one object per line: {"content": "...", "namespace": "...", "tags": ["..."]}.',
    'Answer with the single word NONE when nothing qualifies. Add no other text.',
    '',
    'Conversation:',
    kept.join('\n\n'),
  ].join('\n')}

/**
 * Model text -> facts. Reads each line that parses as a JSON object with a non-empty string
 * content and a namespace in the allowed set; tags kept when an array of strings. Ignores code
 * fences, prose and NONE. At most EXTRACT_MAX_FACTS. A content that matches a credential pattern
 * (private key block, `lr_` token, AWS key id, `password=`/`token=` assignment, a known token
 * prefix with its minimum tail, a connection string with a password) is dropped.
 */
export function parseFacts(text: string, project: string | null): Fact[] {
  const allowed = allowedNamespaces(project)
  const facts: Fact[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('{')) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof obj !== 'object' || obj === null) continue
    const { content, namespace, tags } = obj as Record<string, unknown>
    if (typeof content !== 'string' || content.trim() === '') continue
    if (typeof namespace !== 'string' || !allowed.includes(namespace)) continue
    if (looksLikeCredential(content)) continue
    const fact: Fact = { content, namespace }
    if (Array.isArray(tags) && tags.every((t) => typeof t === 'string')) fact.tags = tags as string[]
    facts.push(fact)
    if (facts.length === EXTRACT_MAX_FACTS) break
  }
  return facts}

/** Asks whether `conflict` is the older version of the same fact as `fact`; answer YES or NO. */
export function buildJudgePrompt(fact: Fact, conflict: Conflict): string {
  return [
    'Two memory entries follow. Decide whether the OLD entry is an earlier version of the same fact as the NEW entry, so that the NEW one replaces it.',
    'Answer YES when both state the same thing and the NEW one is current. Answer NO when they describe different things or both stay true.',
    'Answer with one word, YES or NO.',
    '',
    `NEW: ${fact.content}`,
    `OLD: ${conflict.content}`,
  ].join('\n')}

/** True only when the first word of the trimmed answer is YES, any case. */
export function parseJudge(text: string): boolean {
  const first = text.trim().split(/[^A-Za-z]+/)[0] ?? ''
  return first.toUpperCase() === 'YES'}

function allowedNamespaces(project: string | null): string[] {
  return project ? ['user:me', 'global', `project:${project}`] : ['user:me', 'global']
}

// A fact that reaches the store is read back into every client, so a leaked secret spreads. These
// patterns are a floor, not a scanner: the model is also told to leave secrets out. The prefix
// rules mirror ENG src/domain/tripwire.rs PREFIX_RULES with the same minimum tails, because that
// file's own notes show a bare prefix fires on prose ("keys start with sk-"). The engine refuses
// these at `open`; a refused extractor write would pin its window (src/writes.ts), so the plugin
// drops them first.
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\blr_[A-Za-z0-9_-]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:password|passwd|token|secret|api[_-]?key)\s*=\s*\S+/i,
  // Each prefix needs a boundary before it and a long enough tail of token bytes after it.
  /(?:^|[^A-Za-z0-9_-])(?:sk-ant-[A-Za-z0-9_-]{24}|sk-[A-Za-z0-9_-]{20}|github_pat_[A-Za-z0-9_-]{40}|gh[pousr]_[A-Za-z0-9_-]{30}|glpat-[A-Za-z0-9_-]{20}|xox[bpa]-[A-Za-z0-9_-]{20}|(?:sk|rk)_live_[A-Za-z0-9_-]{16}|hf_[A-Za-z0-9_-]{30}|npm_[A-Za-z0-9_-]{30})/,
]

const URL_WITH_USERINFO = /(?:^|[^A-Za-z0-9_-])(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|rediss?|amqps?):\/\/([^\s/?#,"'`<>)\]]*)/gi

/** Empty, interpolated (`$`, `{`, `}`), `<bracketed>` or a run of `*`: the engine's placeholder test. */
function isPlaceholderPassword(password: string): boolean {
  return password === '' || /[${}]/.test(password) || (password.startsWith('<') && password.endsWith('>')) || /^\*+$/.test(password)
}

function hasUrlPassword(content: string): boolean {
  for (const m of content.matchAll(URL_WITH_USERINFO)) {
    const authority = m[1] ?? ''
    // Userinfo ends at the last `@` and the password starts at the first `:`, as in the engine.
    const at = authority.lastIndexOf('@')
    if (at < 0) continue
    const userinfo = authority.slice(0, at)
    const colon = userinfo.indexOf(':')
    if (colon < 0) continue
    if (!isPlaceholderPassword(userinfo.slice(colon + 1))) return true
  }
  return false
}

function looksLikeCredential(content: string): boolean {
  return CREDENTIAL_PATTERNS.some((re) => re.test(content)) || hasUrlPassword(content)
}
