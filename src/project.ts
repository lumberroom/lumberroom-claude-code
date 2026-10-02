// cwd -> project slug. The slug is the git root's folder name, which is how the owner's
// namespaces already read (project:lumberroom-cloud).

/** True when `path` exists, file or directory. */
export type Exists = (path: string) => Promise<boolean>

/**
 * Walks up from `cwd` (absolute, POSIX) to the first directory holding `.git`, a directory in a
 * checkout and a file in a worktree. Null when it reaches `/` without one.
 */
export async function findGitRoot(cwd: string, exists: Exists): Promise<string | null> {
  let dir = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd
  for (;;) {
    if (await exists(dir === '/' ? '/.git' : `${dir}/.git`)) return dir
    if (dir === '/' || dir === '') return null
    const cut = dir.lastIndexOf('/')
    dir = cut <= 0 ? '/' : dir.slice(0, cut)
  }
}

/** The slug length the engine allows; it cuts after trimming dashes, so a cut slug can end in one. */
const SLUG_MAX = 127

/**
 * The engine's `project_slug` (ENG src/domain/namespaces.rs): trim, drop trailing slashes, take the
 * last segment, lowercase ASCII only, keep `[a-z0-9._]`, turn every other run of characters (a
 * literal `-` included) into one `-`, trim `-` from both ends, cut at 127. The plugin sends the
 * slug as a project name and the engine slugs it again, so the two must agree: `Café` is `caf`
 * on both sides, not `caf-` here and `caf` there. Empty where the engine returns an error.
 */
export function slugFromPath(path: string): string {
  const base = path.trim().replace(/\/+$/, '').split('/').pop() ?? ''
  // toLowerCase would fold `İ` and the Kelvin sign into ASCII letters the engine never produces.
  const lower = base.replace(/[A-Z]/g, (c) => c.toLowerCase())
  const slug = lower.replace(/[^a-z0-9._]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, SLUG_MAX)
}

/**
 * The `project` setting -> the slug to send. `none` -> undefined. `auto` -> the git root's slug,
 * else the cwd's. Anything else is returned trimmed, as given.
 */
export async function resolveProject(setting: string, cwd: string, exists: Exists): Promise<string | undefined> {
  const s = setting.trim()
  if (s === 'none') return undefined
  if (s !== 'auto' && s !== '') return s
  const slug = slugFromPath((await findGitRoot(cwd, exists)) ?? cwd)
  return slug === '' ? undefined : slug
}
