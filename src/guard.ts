// Which file-tool calls touch Claude Code's built-in memory (spec 8).

export const GUARD_REASON =
  "Claude Code's built-in memory is off in this session. Use lumberroom: memory_search to read, memory_write to record."

// Grep and Glob take a search root in `path`. They are absent from the 2.1.287 tool table this
// plugin was built against, so the names are compared as strings and the guard sits idle until a
// build that has them arrives. Bash is not guarded: a command line has no path argument to read.
export const GUARDED_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob'])

/** The path argument of a guarded tool's input (`file_path`, `notebook_path`, or a search tool's `path`), else undefined. */
export function pathArg(tool: string, input: Readonly<Record<string, unknown>>): string | undefined {
  if (!GUARDED_TOOLS.has(tool)) return undefined
  const value = tool === 'NotebookEdit' ? input.notebook_path : tool === 'Grep' || tool === 'Glob' ? input.path : input.file_path
  return typeof value === 'string' ? value : undefined
}

/**
 * The folder part and the last segment of an absolute path, cut on the text alone (a `..` stays
 * for the file system to resolve). Null for a relative path, which has no parent to stat.
 */
export function parentOf(path: string): { parent: string; base: string } | null {
  if (!path.startsWith('/')) return null
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  return { parent: cut <= 0 ? '/' : trimmed.slice(0, cut), base: trimmed.slice(cut + 1) }
}

/**
 * `~` expanded with `home`, `.` and `..` segments resolved, duplicate slashes collapsed. For a
 * path that may not exist yet, where $.fs.stat cannot give realPath. Relative paths resolve
 * against `cwd`.
 */
export function normalizePath(path: string, home: string, cwd: string): string {
  let full = path
  // Only a bare `~` or `~/` means home. `~bob` is a relative name in the shell's eyes too once
  // the shell is not the one expanding it.
  if (full === '~' || full.startsWith('~/')) full = home + full.slice(1)
  if (!full.startsWith('/')) full = `${cwd}/${full}`
  const out: string[] = []
  for (const seg of full.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return `/${out.join('/')}`
}

/**
 * True for `<home>/.claude/MEMORY.md` and for anything under `<home>/.claude/projects/<any>/memory/`
 * (the folder itself included, MEMORY.md there too). A MEMORY.md anywhere else under `.claude` is
 * some plugin's or skill's file and stays readable. `path` is absolute and normalised.
 */
export function isBuiltinMemoryPath(path: string, home: string): boolean {
  // Match whole segments: a prefix test would pass `projects-old` and `memory-old`.
  const claude = `${home.replace(/\/+$/, '')}/.claude/`
  if (!path.startsWith(claude)) return false
  const segs = path.slice(claude.length).split('/').filter(s => s !== '')
  if (segs.length === 1 && segs[0] === 'MEMORY.md') return true
  return segs[0] === 'projects' && segs.length >= 3 && segs[2] === 'memory'
}
