// Every engine call goes through callTool: a timeout the mod API does not give us, result parsing
// that copes with the payload arriving as JSON text (spec 2.2), and one outcome type the hooks
// branch on.

/** The part of $.mcp.call's result this module reads. */
export interface RawResult {
  content: ReadonlyArray<{ type: string; text?: string }>
  isError: boolean
  structuredContent?: unknown
}

export interface McpDeps {
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<RawResult>
  /** $.clock.sleep: the one wait that counts against the hook budget. */
  sleep: (ms: number) => Promise<void>
  now: () => Promise<number>
}

export type CallOutcome =
  | { kind: 'ok'; data: unknown; text: string; ms: number }
  /** The engine answered with isError: a validation or conflict message in `text`. */
  | { kind: 'tool_error'; text: string; ms: number }
  | { kind: 'timeout'; ms: number }
  /** The call threw: no server by that name, connection refused, transport failure. */
  | { kind: 'unreachable'; error: string; ms: number }
  /** The permission chain refused the call ("haven't granted it", "denied"). */
  | { kind: 'denied'; error: string; ms: number }
  /** The server is not (yet) connected, absent, or has its tools removed by the user's settings. */
  | { kind: 'not_connected'; error: string; ms: number }

/**
 * structuredContent when present; else the first text block parsed as JSON; else `data` is the
 * raw text (an engine that answers markdown). `text` is always the first text block, or "".
 */
export function parseResult(raw: RawResult): { isError: boolean; data: unknown; text: string } {
  const block = raw.content.find((b) => b.type === 'text' && typeof b.text === 'string')
  const text = block?.text ?? ''
  if (raw.structuredContent !== undefined && raw.structuredContent !== null) {
    return { isError: raw.isError, data: raw.structuredContent, text }
  }
  try {
    return { isError: raw.isError, data: JSON.parse(text), text }
  } catch {
    return { isError: raw.isError, data: text, text }
  }
}

/**
 * Claude Code 2.1.287 throws this while MCP servers are still connecting, and for a server the
 * user never configured or whose tools their settings disallow (a disallowed tool leaves the
 * engine): `no tool "context_bootstrap" on a server named "lumberroom"; servers with tools: ...`.
 */
const NOT_CONNECTED = [/no (connected )?(mcp )?tool "[^"]+" on a server named/i, /no (mcp )?server (found )?(named|with name)/i]

/** A thrown error from $.mcp.call: a permission refusal, a server that is not connected, or an outage. */
export function classifyError(err: unknown): 'denied' | 'unreachable' | 'not_connected' {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/permission|haven'?t granted|denied/i.test(msg)) return 'denied'
  return NOT_CONNECTED.some((re) => re.test(msg)) ? 'not_connected' : 'unreachable'
}

/**
 * Races deps.call against deps.sleep(timeoutMs). The losing call keeps running and its result,
 * or its rejection, is swallowed. `ms` is measured with deps.now.
 */
export async function callTool(
  deps: McpDeps,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<CallOutcome> {
  const start = await deps.now()
  type Settled = { r: RawResult } | { e: unknown } | { timeout: true }
  // Both arms resolve, never reject, so the losing call cannot raise an unhandled rejection later.
  const call: Promise<Settled> = (async () => deps.call(server, tool, args))().then(
    (r) => ({ r }),
    (e: unknown) => ({ e }),
  )
  const timer: Promise<Settled> = deps.sleep(timeoutMs).then(() => ({ timeout: true as const }))
  const won = await Promise.race([call, timer])
  const ms = (await deps.now()) - start
  if ('timeout' in won) return { kind: 'timeout', ms }
  if ('e' in won) {
    const error = won.e instanceof Error ? won.e.message : String(won.e)
    return { kind: classifyError(won.e), error, ms }
  }
  const parsed = parseResult(won.r)
  if (parsed.isError) return { kind: 'tool_error', text: parsed.text, ms }
  return { kind: 'ok', data: parsed.data, text: parsed.text, ms }
}

/** True for the outcomes that count as an outage: the breaker records them. */
export function isOutage(outcome: CallOutcome): boolean {
  return outcome.kind === 'timeout' || outcome.kind === 'unreachable'
}
