// Which MCP server the plugin talks to. The plugin ships its own server in .mcp.json, which Claude
// Code registers as `plugin:<plugin>:<name>` and suppresses when a server the person registered
// points at the same URL, or a claude.ai connector does. $.mcp.connect on the bundled key answers
// with whichever name the session runs the server under; the list below is the fallback when it
// cannot answer. So the plugin tries the bundled one first and falls back to a registered
// `lumberroom`: the same install works before and after the person removes their own entry, and a
// self-hosted engine registered as `lumberroom` works with no plugin option.
//
// A claude.ai connector is not always seen as a twin. A cloud session (claude.ai/code) gets its
// connectors through a session proxy URL, so Claude Code keeps the bundled server beside it, and
// $.mcp.connect answers that the bundled one needs sign-in, which a fresh container never has.
// The connector's own names close the list: `claude.ai Lumberroom` on the desktop and the CLI,
// `Lumberroom` in a cloud session.

import { OWN_PLUGIN } from './own'

/** The server's key in .mcp.json, which $.mcp.connect takes. */
export const BUNDLED_KEY = 'lumberroom'
export const BUNDLED_SERVER = `plugin:${OWN_PLUGIN}:${BUNDLED_KEY}`
export const REGISTERED_SERVER = 'lumberroom'
/** The names a claude.ai Lumberroom connector runs under: the CLI and desktop spelling, then the cloud session's. */
export const CONNECTOR_SERVERS: readonly string[] = ['claude.ai Lumberroom', 'Lumberroom']

export const SERVER_CANDIDATES: readonly [string, ...string[]] = [BUNDLED_SERVER, REGISTERED_SERVER, ...CONNECTOR_SERVERS]

/** The prefix of a server's tools as Claude Code spells it: `plugin:a:b` becomes `mcp__plugin_a_b__`. */
export function toolPrefix(server: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}__`
}

/** True for the plugin's own server under either name it runs as; false for a connector or anything else. */
export function isBundledName(server: string): boolean {
  return server === BUNDLED_SERVER || server === REGISTERED_SERVER
}

/** What the plugin learned from $.mcp.connect about the bundled server when it was not connected. */
export interface BundledState {
  /** The name Claude Code lists it under, e.g. `plugin:lumberroom-memory:lumberroom`. */
  name: string
  /** True when it waits for an OAuth sign-in ("needs authentication" in /mcp). */
  needsAuth: boolean
}

/**
 * Reads a not-connected $.mcp.connect answer. Claude Code says `auth` for a server that waits for
 * sign-in and names it in the message: `The MCP server "lumberroom" needs you to sign in; ...`.
 */
export function bundledStateFrom(answer: { reason?: unknown; message?: unknown }): BundledState {
  const message = typeof answer.message === 'string' ? answer.message : ''
  const named = /MCP server "([^"]+)"/.exec(message)?.[1]
  const needsAuth = answer.reason === 'auth' || /needs you to sign in|needs-auth|authenticat/i.test(message)
  return { name: named ?? BUNDLED_SERVER, needsAuth }
}

/** The toast after three prompts found no server: what was tried and, when known, why the bundled one is out. */
export function notConnectedToast(tried: readonly string[], bundled: BundledState | null): string {
  const names = tried.map((n) => `"${n}"`).join(', ')
  const why = bundled?.needsAuth === true ? ` "${bundled.name}" needs sign-in: run /mcp to sign in, or connect the Lumberroom connector on claude.ai.` : ' Check /mcp.'
  return `${OWN_PLUGIN}: no lumberroom MCP server with memory tools is connected (tried ${names}).${why}`
}
