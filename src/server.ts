// Which MCP server the plugin talks to. The plugin ships its own server in .mcp.json, which Claude
// Code registers as `plugin:<plugin>:<name>` and suppresses when a server the person registered
// points at the same URL, or a claude.ai connector does. $.mcp.connect on the bundled key answers
// with whichever name the session runs the server under; the list below is the fallback when it
// cannot answer. So `auto` tries the bundled one first and falls back to a registered
// `lumberroom`: the same install works before and after the person removes their own entry.

import { OWN_PLUGIN } from './own'

/** The server's key in .mcp.json, which $.mcp.connect takes. */
export const BUNDLED_KEY = 'lumberroom'
export const BUNDLED_SERVER = `plugin:${OWN_PLUGIN}:${BUNDLED_KEY}`
export const REGISTERED_SERVER = 'lumberroom'

export function serverCandidates(option: string): readonly string[] {
  return option === 'auto' ? [BUNDLED_SERVER, REGISTERED_SERVER] : [option]
}

/** The prefix of a server's tools as Claude Code spells it: `plugin:a:b` becomes `mcp__plugin_a_b__`. */
export function toolPrefix(server: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}__`
}
