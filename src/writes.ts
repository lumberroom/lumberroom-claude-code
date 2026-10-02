// memory_write with a duplicate guard and one supersedes decision made before the write (spec 9.3).
// The engine has no idempotency key, so the guard remembers each fact's key in $.store across
// sessions.

import type { CallOutcome } from './mcp'

export interface Fact {
  content: string
  namespace: string
  tags?: string[]
}

/** One entry of memory_write's possible_conflicts (ENG src/domain/types.rs:148-154). */
export interface Conflict {
  id: string
  namespace: string
  content: string
  similarity?: number
}

/** $.store under a key prefix; values are plain JSON. */
export interface GuardStore {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

export interface WriteDeps {
  /** One memory_write call with these arguments, through callTool. */
  write: (args: Record<string, unknown>) => Promise<CallOutcome>
  store: GuardStore
  /** Rows already stored that read like `fact`, best first; the caller answers [] on any failure. */
  findSimilar: (fact: Fact) => Promise<Conflict[]>
  /** True when `conflict` states the old version of `fact` (the extractor model's call). */
  isOldVersion: (fact: Fact, conflict: Conflict) => Promise<boolean>
  now: () => Promise<number>
}

export type WriteResult =
  /** `conflicts` are the engine's possible_conflicts: the row is stored and the owner settles them in review. */
  | { status: 'written'; id: string; superseded?: string; conflicts?: Conflict[] }
  | { status: 'deduplicated'; id: string }
  /** The guard saw this fact sent before: no call made. */
  | { status: 'skipped'; reason: 'sent-before' | 'in-flight' | 'refused-before' }
  /** The engine answered with an error that no retry fixes: the fact is terminal, so it must not hold a window open. */
  | { status: 'refused'; error: string }
  | { status: 'failed'; error: string }

/** Tag on every write this plugin makes on its own. */
export const AUTO_TAG = 'auto-extract'
/** In-flight entries older than this are treated as lost and may be sent again. */
export const IN_FLIGHT_TTL_MS = 10 * 60_000

/** Lowercase, whitespace collapsed, trailing period dropped. */
export function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '')
}

/** `lr-write:` + hex SHA-256 (crypto.subtle) of `namespace + "\n" + normalizeContent(content)`. */
export async function factKey(fact: Fact): Promise<string> {
  const bytes = new TextEncoder().encode(`${fact.namespace}\n${normalizeContent(fact.content)}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let hex = ''
  for (const b of digest) hex += b.toString(16).padStart(2, '0')
  return `lr-write:${hex}`
}

/** memory_write's parsed data -> its possible_conflicts; [] when absent or malformed. */
export function conflictsFrom(data: unknown): Conflict[] {
  if (typeof data !== 'object' || data === null) return []
  const raw = (data as { possible_conflicts?: unknown }).possible_conflicts
  if (!Array.isArray(raw)) return []
  const out: Conflict[] = []
  for (const c of raw) {
    if (typeof c !== 'object' || c === null) continue
    const { id, namespace, content, similarity } = c as Record<string, unknown>
    if (typeof id !== 'string' || typeof namespace !== 'string' || typeof content !== 'string') continue
    out.push(typeof similarity === 'number' ? { id, namespace, content, similarity } : { id, namespace, content })
  }
  return out
}

/**
 * The live head id in a conflict error such as "memory <uuid> was already superseded. The live row
 * is <uuid>; retry with supersedes set to it ..." (ENG src/services/write.rs:624-630); null when
 * the text names none.
 */
export function liveHeadFrom(errorText: string): string | null {
  // The message opens with the superseded target's own id, so the first uuid in the text is the
  // wrong one. Anchor on the words that precede the head.
  const m = /live row is\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(errorText)
  return m?.[1]?.toLowerCase() ?? null
}

/**
 * Writes one fact, at most two memory_write calls:
 * 1. Guard: key done -> skipped sent-before; key in flight younger than IN_FLIGHT_TTL_MS ->
 *    skipped in-flight. Else mark in flight ({ state: 'in-flight', at }).
 * 2. findSimilar, then isOldVersion for each candidate in order; the first true one is the row the
 *    write replaces. The engine stores a row before it reports possible_conflicts, and a second
 *    write with supersedes skips its dedup, so the decision comes first and one call carries it.
 * 3. Call with { content, namespace, tags: [...fact.tags, AUTO_TAG] deduplicated, supersedes? }.
 *    ok + deduplicated:true -> deduplicated. ok with possible_conflicts -> written with
 *    `conflicts`, no second call. tool_error whose text names a live head -> one retry with
 *    supersedes: that id.
 * 4. Success marks the key { state: 'done', id }. A tool_error with no live head is the engine
 *    refusing the content (the credential tripwire, a validation rule): the key becomes
 *    { state: 'refused', at } and the result is refused, because a resend gets the same answer and
 *    a failed result would pin the extractor's window for ever. A timeout keeps the in-flight
 *    mark, because the call may have landed; the mark expires after IN_FLIGHT_TTL_MS. Every other
 *    failure clears it, since the write did not land, and returns failed with the outcome kind
 *    and text.
 */
export async function writeFact(deps: WriteDeps, fact: Fact): Promise<WriteResult> {
  const key = await factKey(fact)
  const prior = (await deps.store.get(key)) as { state?: string; at?: number } | null | undefined
  const now = await deps.now()
  if (prior?.state === 'done') return { status: 'skipped', reason: 'sent-before' }
  if (prior?.state === 'refused') return { status: 'skipped', reason: 'refused-before' }
  if (prior?.state === 'in-flight' && typeof prior.at === 'number' && now - prior.at <= IN_FLIGHT_TTL_MS) {
    return { status: 'skipped', reason: 'in-flight' }
  }
  await deps.store.set(key, { state: 'in-flight', at: now })

  const base = { content: fact.content, namespace: fact.namespace, tags: [...new Set([...(fact.tags ?? []), AUTO_TAG])] }
  const finish = async (result: WriteResult & { status: 'written' | 'deduplicated' }): Promise<WriteResult> => {
    await deps.store.set(key, { state: 'done', id: result.id })
    return result
  }
  const fail = async (outcome: CallOutcome): Promise<WriteResult> => {
    // A timeout may have landed; the in-flight mark holds retries until its TTL runs out.
    // GuardStore has no delete; null reads as absent.
    if (outcome.kind !== 'timeout') await deps.store.set(key, null)
    return { status: 'failed', error: describe(outcome) }
  }
  const describe = (o: CallOutcome) => (o.kind === 'tool_error' ? `tool_error: ${o.text}` : o.kind === 'ok' ? 'ok' : 'error' in o ? `${o.kind}: ${o.error}` : o.kind)

  let target: string | null = null
  let candidates: Conflict[] = []
  try {
    candidates = await deps.findSimilar(fact)
  } catch {
    // No candidates means a plain write; the engine's own dedup and review queue still apply.
  }
  for (const candidate of candidates) {
    let old = false
    try {
      old = await deps.isOldVersion(fact, candidate)
    } catch {
      // A failed judgement means no supersession for this candidate.
    }
    if (old) {
      target = candidate.id
      break
    }
  }

  let first = await deps.write(target === null ? base : { ...base, supersedes: target })
  if (first.kind === 'tool_error') {
    const head = liveHeadFrom(first.text)
    if (head === null) {
      await deps.store.set(key, { state: 'refused', at: now })
      return { status: 'refused', error: describe(first) }
    }
    target = head
    first = await deps.write({ ...base, supersedes: head })
  }
  if (first.kind !== 'ok') return fail(first)

  const id = idOf(first.data)
  if ((first.data as { deduplicated?: unknown } | null)?.deduplicated === true) return finish({ status: 'deduplicated', id })
  const conflicts = conflictsFrom(first.data)
  return finish({
    status: 'written',
    id,
    ...(target === null ? {} : { superseded: target }),
    ...(conflicts.length === 0 ? {} : { conflicts }),
  })
}

function idOf(data: unknown): string {
  const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined
  return typeof id === 'string' ? id : ''
}
