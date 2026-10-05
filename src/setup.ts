// /lr-setup: the allow rules the plugin's own calls need, and the merge that adds them to the
// person's user settings. Claude Code runs the plugin's context_bootstrap, memory_search and
// memory_write through the person's permission rules, and a plugin may not answer that check
// itself, so the person adds the rules once. Pure functions; hooks/register.ts asks, reads and
// writes.

import { toolPrefix } from './server'

/** The tools the plugin calls without the model asking (docs/permissions.md). */
export const SETUP_TOOLS = ['context_bootstrap', 'memory_search', 'memory_write'] as const

export const SETUP_USAGE = 'Usage: /lr-setup [show]. With no argument it asks, then adds the allow rules to your user settings.'
export const ADD_LABEL = 'Add them'
export const CANCEL_LABEL = 'Cancel'

/** The allow rules for the server lumberroom runs under. */
export function setupRules(server: string): string[] {
  const prefix = toolPrefix(server)
  return SETUP_TOOLS.map((tool) => `${prefix}${tool}`)
}

/**
 * True when `rules` holds an entry that covers `rule`: the rule itself, the server's wildcard
 * (`mcp__x__*`) or the bare server (`mcp__x`), which Claude Code reads as every tool on it.
 */
export function isCovered(rule: string, rules: readonly unknown[]): boolean {
  const cut = rule.lastIndexOf('__')
  const server = cut > 0 ? rule.slice(0, cut) : rule
  return rules.some((r) => r === rule || r === `${server}__*` || r === server)
}

export function missingRules(rules: readonly string[], allow: readonly unknown[]): string[] {
  return rules.filter((r) => !isCovered(r, allow))
}

/** The allow and deny lists of a settings object, empty where absent or malformed. */
export function permissionLists(settings: unknown): { allow: readonly unknown[]; deny: readonly unknown[] } {
  const perms = isObject(settings) ? settings.permissions : undefined
  if (!isObject(perms)) return { allow: [], deny: [] }
  return { allow: Array.isArray(perms.allow) ? perms.allow : [], deny: Array.isArray(perms.deny) ? perms.deny : [] }
}

export type Merge = { ok: true; text: string; added: string[] } | { ok: false; error: string }

/**
 * Adds the missing `rules` to permissions.allow in a settings file's text. '' is a file not there
 * yet. Text that does not parse as a JSON object, or a permissions or allow of the wrong type, is
 * refused rather than overwritten. Every other key is kept.
 */
export function mergeAllow(text: string, rules: readonly string[]): Merge {
  let parsed: unknown = {}
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: 'it is not valid JSON' }
    }
  }
  if (!isObject(parsed)) return { ok: false, error: 'it does not hold a JSON object' }
  const perms = parsed.permissions ?? {}
  if (!isObject(perms)) return { ok: false, error: 'its permissions key is not an object' }
  const allow = perms.allow ?? []
  if (!Array.isArray(allow)) return { ok: false, error: 'its permissions.allow is not a list' }
  const added = missingRules(rules, allow)
  if (added.length === 0) return { ok: true, text, added }
  const next = { ...parsed, permissions: { ...perms, allow: [...allow, ...added] } }
  return { ok: true, text: `${JSON.stringify(next, null, 2)}\n`, added }
}

/** The manual route, for `show`, a cancelled dialog or a session with no one to ask. */
export function manualText(path: string, rules: readonly string[]): string {
  return [
    `Add these to permissions.allow in ${path}, or run /permissions and add them under Allow:`,
    ...rules.map((r) => `  ${r}`),
    'Then start a new session, or run /lr-setup again to load the digest now.',
  ].join('\n')
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
