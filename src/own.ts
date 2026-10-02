// The permission decision for the plugin's own engine calls. $.mcp.call runs the tool.check chain
// even for a plugin's call (spec 2.4), so without an allow every recall and write is refused under
// `claude -p` with no rule. The decision is a pure function so a test can reach it: the test kit
// raises tool.check as the engine and cannot raise it as this plugin.

export const OWN_PLUGIN = 'lumberroom-memory'

const OWN_TOOLS = ['context_bootstrap', 'memory_search', 'memory_write'] as const

/**
 * The tool names Claude Code gives this plugin's three engine calls. A server name keeps only
 * letters, digits, `_` and `-` in a tool name; the narrower spelling (spaces and dots only) is
 * listed too so a rule the declarations do not state cannot leave the allow hook dead.
 */
export function ownToolNames(server: string): ReadonlySet<string> {
  const names = new Set<string>()
  for (const spelled of [server.replace(/[^a-zA-Z0-9_-]/g, '_'), server.replace(/[ .]/g, '_')]) {
    for (const tool of OWN_TOOLS) names.add(`mcp__${spelled}__${tool}`)
  }
  return names
}

/** True when `originPlugin` is this plugin and `tool` is one of its three calls on `server`. */
export function allowsOwnCall(originPlugin: string, tool: string, server: string): boolean {
  return originPlugin === OWN_PLUGIN && ownToolNames(server).has(tool)
}
