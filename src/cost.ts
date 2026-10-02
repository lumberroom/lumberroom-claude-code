// The token counter on the status line: what lumberroom adds to the context the model reads.
// Counts are estimates at four characters a token. The mod API counts tokens only for whole
// context categories, so a per-block count has to be estimated.

export interface Cost {
  /** The system prompt section, sent with every request. */
  section: number
  /** Recall and reminder blocks attached to prompts since the context last emptied. */
  blocks: number
  /** Results of the model's own calls to lumberroom tools since the context last emptied. */
  tools: number
  toolCalls: number
}

export const NO_COST: Cost = { section: 0, blocks: 0, tools: 0, toolCalls: 0 }

export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** True for an MCP tool name served by `server`, as Claude Code spells it (`mcp__<server>__<tool>`). */
export function isServerTool(tool: string, server: string): boolean {
  return tool.startsWith(`mcp__${server}__`)
}

/** Compaction and /clear drop the transcript; the section comes back with the next request. */
export function afterContextReset(cost: Cost): Cost {
  return { ...NO_COST, section: cost.section }
}

function short(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`
}

/** `lumberroom ~2.4k tokens in context: digest 2.0k, reminders 30, tools 400 (2 calls)`. */
export function formatStatus(cost: Cost): string {
  const total = cost.section + cost.blocks + cost.tools
  const parts = [`digest ${short(cost.section)}`, `reminders ${short(cost.blocks)}`, `tools ${short(cost.tools)} (${cost.toolCalls} ${cost.toolCalls === 1 ? 'call' : 'calls'})`]
  return `lumberroom ~${short(total)} tokens in context: ${parts.join(', ')}`
}
