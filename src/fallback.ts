// The digest's second route, for a machine where Claude Code's built-in guard (sec-default@builtin)
// holds prompt.compose past the user tier. The guard seats itself with managed settings or a Team or
// Enterprise login, and a plugin installed from a GitHub marketplace always sits in the user tier, so
// the plugin's section never reaches the system prompt there. prompt.submit context still passes.

/** $.store key, kept across sessions: a past session on this machine finished a turn with no prompt.compose. */
export const GUARD_SEEN_KEY = 'guard-seen'

export const GUARD_NOTICE =
  "lumberroom: Claude Code's built-in guard (sec-default) holds this plugin's system-prompt hook, so the digest now rides on your prompts instead. For the full plugin, see the README section \"Organization-managed Claude Code\"."

/**
 * True when a finished turn shows the guard holds prompt.compose: the main conversation's model
 * answered and the plugin's compose hook never ran this session. An interactive session raises
 * prompt.compose after prompt.submit, so the first prompt cannot tell; the turn's end can.
 */
export function guardHeld(turn: { composed: boolean; agentId: string | undefined; reason: string }): boolean {
  return !turn.composed && turn.agentId === undefined && turn.reason === 'answer'
}
