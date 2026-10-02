// The plan behind `/lr-import all`: which namespace each memory folder's project and reference
// memories should land in. A folder name such as `-home-u-work-my-repo` does not say where one path
// segment ends, so the plan finds the path when it exists and asks the model when it does not. The
// person confirms each folder before anything is posted.

import { slugFromPath } from './project'
import type { Exists } from './project'

/** How the proposed namespace was chosen. `fallback` is global after an unusable model answer. */
export type PlanHow = 'current' | 'path' | 'model' | 'fallback'
export type PlanStatus = 'pending' | 'done' | 'skipped'

/** One memory folder in the plan. Kept in `$.store` under PLAN_KEY, so it survives a reload. */
export interface PlanEntry {
  /** The folder's name under ~/.claude/projects. */
  folder: string
  /** Parseable memory files when the plan was built. */
  files: number
  /** The slug for project and reference memories; null is global. user and feedback never use it. */
  slug: string | null
  how: PlanHow
  reason: string
  status: PlanStatus
}

export const PLAN_KEY = 'lr-import:plan'

/** The most `exists` calls one folder name may cost. A deep path with many dashes stays well under it. */
export const DECODE_BUDGET = 300
/** Memory files named in the model prompt. */
export const PROMPT_FILES = 5
const DESCRIPTION_MAX = 200

/** Characters that Claude Code's folder naming turned into `-`, tried in this order when a dash was inside a segment. */
const JOINERS = ['-', '_', '.', ' ']

/**
 * Reads a project folder name back into an existing absolute path, or null. The name came from
 * `replace(/[^a-zA-Z0-9]/g, "-")`, so a dash can be a slash or a character inside a segment. The
 * walk descends only into folders that exist, tries the shortest segment first, and stops after
 * `budget` probes. A double dash is read as a hidden folder (`/.config`). Mixed joiners inside one
 * segment (`my-app_v2`) are not tried: the model's guess covers what this does not find.
 */
export async function decodeProjectDir(name: string, exists: Exists, budget: number = DECODE_BUDGET): Promise<string | null> {
  if (!name.startsWith('-')) return null
  const tokens = name.slice(1).split('-')
  let left = budget

  const walk = async (dir: string, i: number): Promise<string | null> => {
    if (i >= tokens.length) return dir
    // An empty token is the dash a `.` left behind: the next segment starts with a dot.
    const dotted = tokens[i] === ''
    const start = dotted ? i + 1 : i
    const lead = dotted ? '.' : ''
    for (let end = start + 1; end <= tokens.length; end++) {
      const parts = tokens.slice(start, end)
      if (parts.some((p) => p === '')) break
      for (const joiner of end - start === 1 ? ['-'] : JOINERS) {
        if (left <= 0) return null
        left -= 1
        const candidate = `${dir}/${lead}${parts.join(joiner)}`
        if (!(await exists(candidate))) continue
        const found = await walk(candidate, end)
        if (found !== null) return found
      }
    }
    return null
  }

  return tokens.length === 0 ? null : walk('', 0)
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

/**
 * The one question put to the model for a folder whose path was not found. File names and
 * descriptions are data; the answer is validated by parseNamespaceAnswer, so a hostile description
 * can at worst pick a wrong slug, which the person sees in the table before anything is posted.
 */
export function buildNamespacePrompt(folder: string, files: ReadonlyArray<{ name: string; description: string }>): string {
  const lines = files.slice(0, PROMPT_FILES).map((f) => `- ${clip(f.name, 80)}: ${clip(f.description, DESCRIPTION_MAX)}`)
  return [
    "Claude Code keeps a project's memory files in a folder named after the project's path, with every character outside a-z, A-Z and 0-9 turned into a dash.",
    "Name the project this folder belongs to as a short slug: its own folder name, lowercase, using letters, digits, dots, underscores and single dashes. If the memories are not about one project, answer global.",
    'Reply with the slug or global and nothing else.',
    '',
    `Folder: ${folder}`,
    'Memory files:',
    ...lines,
  ].join('\n')
}

const asciiLower = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase())

/**
 * The model's reply -> `global`, a slug, or null when the reply is neither. A slug passes only when
 * the engine's slug rule leaves it unchanged, so a sentence, a path or a name with a double dash
 * never becomes a namespace. Surrounding quotes and backticks are dropped; case is folded.
 */
export function parseNamespaceAnswer(text: string): string | null {
  let t = text.trim()
  const quote = t[0]
  if (t.length >= 2 && (quote === '`' || quote === '"' || quote === "'") && t[t.length - 1] === quote) t = t.slice(1, -1).trim()
  const lower = asciiLower(t)
  if (lower === 'global') return 'global'
  const slug = slugFromPath(lower)
  return slug !== '' && slug === lower ? slug : null
}

export type OverrideResult = { ok: true; slug: string | null } | { ok: false; error: string }

/** The namespace a person types on `/lr-import confirm <n> <namespace>`: a slug, `project:<slug>` or `global`. */
export function parseNamespaceOverride(input: string): OverrideResult {
  const raw = input.trim().replace(/^project:/i, '')
  const answer = parseNamespaceAnswer(raw)
  if (answer === null) {
    return { ok: false, error: `"${clip(input, 60)}" is not a namespace. Use global, a project slug such as my-repo, or project:my-repo.` }
  }
  return { ok: true, slug: answer === 'global' ? null : answer }
}

export type ImportCommand =
  | { kind: 'current' }
  | { kind: 'build' }
  | { kind: 'plan' }
  | { kind: 'confirm'; target: string; namespace?: string }
  | { kind: 'skip'; target: string }
  | { kind: 'usage' }

export const IMPORT_USAGE =
  'Usage: /lr-import | /lr-import all | /lr-import plan | /lr-import confirm <n|folder> [namespace] | /lr-import confirm all | /lr-import skip <n>. With no argument it reads this project; "all" lists every project folder and proposes a namespace for each, and nothing is posted until you confirm.'

export function parseImportArgs(args: string): ImportCommand {
  const tokens = args.trim().split(/\s+/).filter((t) => t !== '')
  const verb = asciiLower(tokens[0] ?? '')
  if (tokens.length === 0) return { kind: 'current' }
  if (tokens.length === 1 && verb === 'all') return { kind: 'build' }
  if (tokens.length === 1 && verb === 'plan') return { kind: 'plan' }
  if (verb === 'skip' && tokens.length === 2) return { kind: 'skip', target: tokens[1] as string }
  if (verb === 'confirm' && (tokens.length === 2 || tokens.length === 3)) {
    const first = tokens[1] as string
    const target = asciiLower(first) === 'all' ? 'all' : first
    const namespace = tokens[2]
    if (namespace === undefined) return { kind: 'confirm', target }
    return target === 'all' ? { kind: 'usage' } : { kind: 'confirm', target, namespace }
  }
  return { kind: 'usage' }
}

const STATUSES: ReadonlySet<string> = new Set(['pending', 'done', 'skipped'])
const HOWS: ReadonlySet<string> = new Set(['current', 'path', 'model', 'fallback'])

/** The stored plan -> entries. A value that is not a plan answers [], so a stale or damaged store reads as no plan. */
export function parsePlan(raw: unknown): PlanEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PlanEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return []
    const e = item as Record<string, unknown>
    if (
      typeof e.folder !== 'string' ||
      typeof e.files !== 'number' ||
      !(e.slug === null || typeof e.slug === 'string') ||
      typeof e.how !== 'string' ||
      !HOWS.has(e.how) ||
      typeof e.reason !== 'string' ||
      typeof e.status !== 'string' ||
      !STATUSES.has(e.status)
    ) {
      return []
    }
    out.push({ folder: e.folder, files: e.files, slug: e.slug, how: e.how as PlanHow, reason: e.reason, status: e.status as PlanStatus })
  }
  return out
}

export const namespaceLabel = (slug: string | null): string => (slug === null ? 'global' : `project:${slug}`)

const HOW_LABEL: Record<PlanHow, string> = {
  current: 'current project',
  path: 'path found',
  model: 'model guess',
  fallback: 'model guess unusable',
}

/** The numbered table `all` and `plan` answer with. Numbers stay fixed as folders finish, so `skip 2` means the same row all session. */
export function formatPlan(entries: readonly PlanEntry[]): string {
  if (entries.length === 0) return 'lr-import: no memory folders with parseable files were found under ~/.claude/projects.'
  const rows = [
    ['#', 'folder', 'files', 'namespace', 'chosen by', 'status'],
    ...entries.map((e, i) => [String(i + 1), e.folder, String(e.files), namespaceLabel(e.slug), HOW_LABEL[e.how], e.status]),
  ]
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => (r[c] as string).length)))
  const table = rows.map((r) => r.map((cell, c) => cell.padEnd(widths[c] as number)).join('  ').trimEnd())
  return [
    'lr-import plan. Nothing is posted until you confirm. The namespace applies to project and reference memories; user and feedback memories go to user:me.',
    '',
    ...table,
    '',
    ...entries.map((e, i) => `${i + 1}: ${e.reason}`),
    '',
    'Next: /lr-import confirm <n|folder> [namespace], /lr-import confirm all, /lr-import skip <n>, /lr-import plan.',
  ].join('\n')
}
