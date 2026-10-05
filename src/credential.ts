// Where /lr-import sends memory files and which bearer it carries. The lumberroom CLI already holds
// both: `lumberroom login` writes an OAuth token and the engine URL to its config file, so a person
// who uses the CLI configures nothing here. The order mirrors the CLI's own `resolve` in
// crates/lumberroom/src/config.rs (environment beats file, a static token beats an OAuth one), with
// the plugin's ingestToken option in front of all of them.

/** The engine the bundled MCP server talks to, without /mcp. */
export const DEFAULT_ENGINE = 'https://mcp.lumberroom.cloud'

export type IngestSource = 'option' | 'env' | 'cli-token' | 'cli-oauth'

export interface IngestCredential {
  /** Engine base URL without a trailing slash or /mcp. */
  baseUrl: string
  token: string
  source: IngestSource
}

export interface IngestInputs {
  /** The ingestToken option, already trimmed; undefined when unset. */
  optionToken?: string
  /** LUMBERROOM_URL and LUMBERROOM_TOKEN from the environment. */
  envUrl?: string
  envToken?: string
  /** The CLI config file's text, '' when absent or unreadable. */
  cliConfig: string
  /** Milliseconds since the epoch. */
  now: number
}

export type IngestResolution = { ok: true; credential: IngestCredential } | { ok: false; reason: 'none' | 'expired' }

/** The CLI's config path: LUMBERROOM_CONFIG, else ~/.config/lumberroom/config.json. */
export function cliConfigPath(envConfig: string | undefined, home: string): string {
  const set = envConfig?.trim() ?? ''
  return set !== '' ? set : `${home}/.config/lumberroom/config.json`
}

/** A URL the CLI accepts (base or .../mcp) -> the engine base the /admin routes hang off. */
export function engineBase(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/mcp$/, '')
}

const field = (obj: unknown, key: string): string => {
  if (typeof obj !== 'object' || obj === null) return ''
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** Never throws. An empty value counts as unset at every step, as in the CLI. */
export function resolveIngest(inputs: IngestInputs): IngestResolution {
  let file: unknown = {}
  try {
    file = JSON.parse(inputs.cliConfig)
  } catch {
    file = {}
  }
  const oauth = typeof file === 'object' && file !== null ? (file as Record<string, unknown>).oauth : undefined

  const url = [inputs.envUrl?.trim() ?? '', field(file, 'url')].find((u) => u !== '') ?? DEFAULT_ENGINE
  const baseUrl = engineBase(url)

  const statics: [string, IngestSource][] = [
    [inputs.optionToken?.trim() ?? '', 'option'],
    [inputs.envToken?.trim() ?? '', 'env'],
    [field(file, 'token'), 'cli-token'],
  ]
  for (const [token, source] of statics) if (token !== '') return { ok: true, credential: { baseUrl, token, source } }

  const access = field(oauth, 'access_token')
  if (access === '') return { ok: false, reason: 'none' }
  // The CLI refreshes on its next request, so an expired token means "run any lumberroom command".
  const expires = Date.parse(field(oauth, 'expires_at'))
  if (Number.isFinite(expires) && expires <= inputs.now) return { ok: false, reason: 'expired' }
  return { ok: true, credential: { baseUrl, token: access, source: 'cli-oauth' } }
}
