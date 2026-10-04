// The plugin's options, read once per load. Every userConfig field has a default here too, so a
// value the manifest's validation let through still lands inside its range.

import { slugFromPath } from './project'

export type ExtractorMode = 'off' | 'turn' | 'session-end'

/**
 * Parsed `recallExtraProjects`. Claude Code reads plugin options from user, --settings or managed
 * settings only, never from project settings, so a per-project value lives inside the option.
 */
export interface RecallExtras {
  /** Slugs searched in every project. */
  everywhere: string[]
  /** Project slug -> slugs searched only when that project is current. */
  byProject: Record<string, string[]>
}

export interface Config {
  server: string
  /** The engine's /mcp endpoint, the source of baseUrl. The bundled server's URL is fixed in .mcp.json. */
  mcpUrl: string
  /** For /lr-import: the option, else mcpUrl without its trailing /mcp. */
  baseUrl: string
  /** `auto`, `none`, or a slug. */
  project: string
  /** Off by default: each recall block stays in context for the rest of the session (spec 2.1). */
  recall: boolean
  /** Other projects to search with each prompt, in the engine's slug form, deduplicated. May hold the current project's own slug; `extrasFor` resolves it. */
  recallExtraProjects: RecallExtras
  recallLimit: number
  recallMaxChars: number
  /** Hits with a similarity below this are dropped. Hits that carry none pass. */
  recallMinSimilarity: number
  recallTimeoutMs: number
  bootstrapTimeoutMs: number
  digestMaxChars: number
  reviewInterval: number
  replaceBuiltinMemory: boolean
  extractor: ExtractorMode
  extractorModel: string
  /** Absent when unset or blank. */
  ingestToken?: string
}

export const DEFAULTS: Config = {
  server: 'auto',
  mcpUrl: 'https://mcp.lumberroom.cloud/mcp',
  baseUrl: 'https://mcp.lumberroom.cloud',
  project: 'auto',
  recall: false,
  recallExtraProjects: { everywhere: [], byProject: {} },
  recallLimit: 6,
  recallMaxChars: 4000,
  recallMinSimilarity: 0.6,
  recallTimeoutMs: 2500,
  bootstrapTimeoutMs: 4000,
  digestMaxChars: 8000,
  reviewInterval: 8,
  replaceBuiltinMemory: true,
  extractor: 'off',
  extractorModel: 'haiku',
}

/**
 * The extra slugs to search in `currentSlug`: `everywhere` plus that project's own entry,
 * deduplicated, without the current slug itself. `currentSlug` is undefined with project `none`,
 * so only `everywhere` applies.
 */
export function extrasFor(extras: RecallExtras, currentSlug: string | undefined): string[] {
  // hasOwn keeps a project named `constructor` or `toString` from reading Object.prototype.
  const own = currentSlug !== undefined && Object.hasOwn(extras.byProject, currentSlug) ? (extras.byProject[currentSlug] ?? []) : []
  return [...new Set([...extras.everywhere, ...own])].filter((slug) => slug !== currentSlug)
}

/**
 * Options as `register` receives them -> Config. A value of the wrong type, or a number outside
 * the manifest's min and max, falls back to the default or is clamped. `baseUrl` loses any
 * trailing slash. Never throws.
 */
export function readConfig(options: Readonly<Record<string, unknown>>): Config {
  const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() !== '' ? v.trim() : d)
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  // Mirrors min and max in .claude-plugin/plugin.json. Change both together.
  const num = (v: unknown, d: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d

  // Similarity is a fraction, so this one skips the rounding `num` does.
  const frac = (v: unknown, d: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d

  // Split on commas and whitespace, then slug each entry the way the engine does, so a name the
  // engine would reject or rewrite never reaches memory_search as a namespace. `a=b+c` scopes b
  // and c to project a; a malformed entry (`=x`, `x=`, `a=b=c`) is dropped whole.
  const extras = (v: unknown): RecallExtras => {
    const everywhere = new Set<string>()
    const scoped = new Map<string, Set<string>>()
    for (const entry of typeof v === 'string' ? v.split(/[,\s]+/) : []) {
      const sides = entry.split('=')
      if (sides.length === 1) {
        const slug = slugFromPath(entry)
        if (slug !== '') everywhere.add(slug)
        continue
      }
      if (sides.length !== 2) continue
      const project = slugFromPath(sides[0] ?? '')
      const slugsOf = (sides[1] ?? '').split('+').map(slugFromPath).filter((x) => x !== '')
      if (project === '' || slugsOf.length === 0) continue
      const set = scoped.get(project) ?? new Set<string>()
      for (const slug of slugsOf) set.add(slug)
      scoped.set(project, set)
    }
    // fromEntries defines own properties, so a project named `__proto__` stays plain data.
    return { everywhere: [...everywhere], byProject: Object.fromEntries([...scoped].map(([k, set]) => [k, [...set]])) }
  }

  const extractor = options.extractor
  const mcpUrl = str(options.mcpUrl, DEFAULTS.mcpUrl).replace(/\/+$/, '')
  const token = typeof options.ingestToken === 'string' ? options.ingestToken.trim() : ''
  const config: Config = {
    server: str(options.server, DEFAULTS.server),
    mcpUrl,
    baseUrl: str(options.baseUrl, mcpUrl.replace(/\/mcp$/, '')).replace(/\/+$/, ''),
    project: str(options.project, DEFAULTS.project),
    recall: bool(options.recall, DEFAULTS.recall),
    recallExtraProjects: extras(options.recallExtraProjects),
    recallLimit: num(options.recallLimit, DEFAULTS.recallLimit, 1, 20),
    recallMaxChars: num(options.recallMaxChars, DEFAULTS.recallMaxChars, 500, 16000),
    recallMinSimilarity: frac(options.recallMinSimilarity, DEFAULTS.recallMinSimilarity, 0, 1),
    recallTimeoutMs: num(options.recallTimeoutMs, DEFAULTS.recallTimeoutMs, 500, 8000),
    bootstrapTimeoutMs: num(options.bootstrapTimeoutMs, DEFAULTS.bootstrapTimeoutMs, 500, 8000),
    digestMaxChars: num(options.digestMaxChars, DEFAULTS.digestMaxChars, 1000, 30000),
    reviewInterval: num(options.reviewInterval, DEFAULTS.reviewInterval, 0, 100),
    replaceBuiltinMemory: bool(options.replaceBuiltinMemory, DEFAULTS.replaceBuiltinMemory),
    extractor: extractor === 'turn' || extractor === 'session-end' ? extractor : 'off',
    extractorModel: str(options.extractorModel, DEFAULTS.extractorModel),
  }
  if (token !== '') config.ingestToken = token
  return config
}
