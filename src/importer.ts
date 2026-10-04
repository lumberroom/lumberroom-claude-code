// /lr-import: Claude Code's memory files -> the engine's proposal queue, the way
// lumberroom-hermes importer.py does it (HP/importer.py:62-115). Never the live store.

import { raceSleep } from './race'

export const EXTRACTOR = 'claude-code-builtin-import'
/** Never auto-approves (ENG src/services/ingest.rs:97-106). */
export const SPEAKER = 'main_model'
export const IMPORT_TAG = 'claude-code-import'
export const BATCH_SIZE = 100
/** One ingest call may take this long before the import reports a timeout and moves on. */
export const FETCH_TIMEOUT_MS = 15_000
/** The close gets a shorter bound of its own, so a dead server costs at most one more wait. */
export const CLOSE_TIMEOUT_MS = 5_000

export interface MemoryFile {
  name: string
  description: string
  /** user | feedback | project | reference, or another string as written. */
  type: string
  body: string
}

export interface ProposalFact {
  content: string
  namespace: string
  tags: string[]
  speaker: string
  span_text: string
  source: { file_path: string; entry_uuid: string; run_id: string }
}

export interface ImportReport {
  runId: string | null
  files: number
  posted: number
  proposalsNew: number
  proposalsReinforced: number
  /** Facts the store had already emitted: confirmed, no proposal made. */
  confirmations: number
  refused: number
  blocked: number
  /** Set when the run stopped: a missing token, a 403, a transport failure. */
  error?: string
}

export interface HttpDeps {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; text: string }>
  /** $.clock.sleep. $.http.fetch takes no timeout, so each call races this. */
  sleep: (ms: number) => Promise<void>
}

/** The characters of a project folder name that survive Claude Code's truncation. */
export const PROJECT_DIR_KEPT = 200

/**
 * Claude Code's folder name for a project: every character outside `[a-zA-Z0-9]` becomes `-`
 * (2.1.287 runs `replace(/[^a-zA-Z0-9]/g, "-")`). The result can be longer than the folder: the
 * binary cuts a name over PROJECT_DIR_KEPT characters and appends a hash this plugin cannot
 * reproduce, so match folders with projectDirMatches.
 */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Whether the folder `entry` under ~/.claude/projects belongs to the project named `name`. A short
 * name must match whole. A name over PROJECT_DIR_KEPT characters matches on its first
 * PROJECT_DIR_KEPT, because the folder carries those and a hash after them.
 */
export function projectDirMatches(name: string, entry: string): boolean {
  if (name.length <= PROJECT_DIR_KEPT) return entry === name
  return entry.startsWith(name.slice(0, PROJECT_DIR_KEPT))
}

/**
 * Null when `baseUrl` may carry the ingest token: https, or http to localhost or 127.0.0.1. The
 * bearer travels in every request, so a plain-http remote host would send it in the clear.
 */
export function checkBaseUrl(baseUrl: string): string | null {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/.exec(baseUrl.trim())
  const refusal = `the engine URL must be https (http is allowed for localhost and 127.0.0.1 only), so the ingest token is not sent in the clear. Got: ${baseUrl.trim().slice(0, 80) || '(empty)'}`
  if (!m) return refusal
  if ((m[1] as string).toLowerCase() === 'https') return null
  if ((m[1] as string).toLowerCase() !== 'http') return refusal
  // The host follows the last `@`, so userinfo naming localhost before it does not make the URL local.
  const authority = m[2] as string
  const host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' ? null : refusal
}

function unquote(value: string): string {
  const v = value.trim()
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) return v.slice(1, -1)
  return v
}

/**
 * A memory file (YAML-style frontmatter between `---` lines with name, description and either
 * `type:` or `metadata:` -> `type:`) -> MemoryFile. Null for MEMORY.md, for a file with no
 * frontmatter, or an empty body. A frontmatter-free fallback is not attempted.
 */
export function parseMemoryFile(fileName: string, text: string): MemoryFile | null {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1)
  if (base === 'MEMORY.md') return null
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n')
  if (lines[0]?.trim() !== '---') return null
  // The first `---` after the opener closes the block. A body may hold its own rule lines.
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] as string).trim() === '---') {
      close = i
      break
    }
  }
  if (close < 0) return null

  const top: Record<string, string> = {}
  let metaType = ''
  // Only `metadata:` is read as a nested block. A `type:` under any other key is not the type.
  let block = ''
  for (const line of lines.slice(1, close)) {
    if (line.trim() === '') continue
    const m = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    const indent = (m[1] as string).length
    const key = m[2] as string
    const value = unquote(m[3] as string)
    if (indent === 0) {
      block = value === '' ? key : ''
      if (value !== '') top[key] = value
    } else if (block === 'metadata' && key === 'type') {
      metaType = value
    }
  }

  const body = lines.slice(close + 1).join('\n').trim()
  if (body === '') return null
  const name = top.name ?? base.replace(/\.md$/, '')
  return { name, description: top.description ?? '', type: metaType || top.type || '', body }
}

/** user and feedback -> user:me; project and reference -> project:<slug> (global with no slug); else global. */
export function namespaceFor(type: string, slug: string | null): string {
  const t = type.trim().toLowerCase()
  if (t === 'user' || t === 'feedback') return 'user:me'
  if (t === 'project' || t === 'reference') return slug ? `project:${slug}` : 'global'
  return 'global'
}

/** Hex SHA-256 of the body through crypto.subtle. */
export async function entryUuid(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export async function toProposalFacts(files: ReadonlyArray<{ path: string; file: MemoryFile }>, slug: string | null, runId: string): Promise<ProposalFact[]> {
  const facts: ProposalFact[] = []
  for (const { path, file } of files) {
    facts.push({
      content: file.body,
      namespace: namespaceFor(file.type, slug),
      tags: [IMPORT_TAG],
      speaker: SPEAKER,
      span_text: file.body,
      source: { file_path: path, entry_uuid: await entryUuid(file.body), run_id: runId },
    })
  }
  return facts
}

const MISSING_GRANT =
  'the ingest token lacks the mayIngest grant (HTTP 403). Issue a bearer with mayIngest and set it as the ingestToken option.'

function failure(status: number, text: string): string {
  return status === 403 ? MISSING_GRANT : `lumberroom ingest call failed (HTTP ${status}): ${text.slice(0, 200)}`
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text)
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function count(obj: Record<string, unknown>, key: string): number {
  const v = obj[key]
  return typeof v === 'number' ? v : 0
}

function describeError(e: unknown): string {
  return `lumberroom ingest call failed: ${e instanceof Error ? e.message : String(e)}`
}

/**
 * POST {baseUrl}/admin/ingest/runs {extractor, scope:{tool:"claude-code"}} -> run_id; the facts
 * in batches of BATCH_SIZE to /admin/ingest/proposals {extractor, facts}; then
 * /admin/ingest/runs/{id}/close. Bearer `token`. A base URL that fails checkBaseUrl sends nothing.
 * A 403 stops with an error naming mayIngest; any other non-2xx stops with the status and the first
 * 200 characters of the body. Every call races FETCH_TIMEOUT_MS (the close, CLOSE_TIMEOUT_MS) and
 * a timeout is reported like any failure. The run is closed even after a failed batch.
 */
export async function postProposals(deps: HttpDeps, baseUrl: string, token: string, build: (runId: string) => Promise<ProposalFact[]>, files: number): Promise<ImportReport> {
  const root = baseUrl.replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const report: ImportReport = { runId: null, files, posted: 0, proposalsNew: 0, proposalsReinforced: 0, confirmations: 0, refused: 0, blocked: 0 }
  const unsafe = checkBaseUrl(baseUrl)
  if (unsafe !== null) return { ...report, error: unsafe }

  const send = async (path: string, body: unknown, bound: number) => {
    const raced = await raceSleep(deps.fetch(`${root}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), deps.sleep, bound)
    if (raced.timedOut) throw new ImportTimeout(`POST ${path} timed out after ${bound / 1000} s`)
    return raced.value
  }

  let runId: string
  try {
    const res = await send('/admin/ingest/runs', { extractor: EXTRACTOR, scope: { tool: 'claude-code' } }, FETCH_TIMEOUT_MS)
    if (!res.ok) return { ...report, error: failure(res.status, res.text) }
    const id = parseObject(res.text).run_id
    if (typeof id !== 'string' || id === '') return { ...report, error: 'lumberroom opened a run but returned no run_id.' }
    runId = id
  } catch (e) {
    return { ...report, error: describeError(e) }
  }
  report.runId = runId

  let seen = 0
  try {
    const facts = await build(runId)
    seen = facts.length
    for (let start = 0; start < facts.length; start += BATCH_SIZE) {
      const batch = facts.slice(start, start + BATCH_SIZE)
      const res = await send('/admin/ingest/proposals', { extractor: EXTRACTOR, facts: batch }, FETCH_TIMEOUT_MS)
      if (!res.ok) {
        report.error = failure(res.status, res.text)
        break
      }
      const out = parseObject(res.text)
      report.posted += batch.length
      report.proposalsNew += count(out, 'proposals_new')
      report.proposalsReinforced += count(out, 'proposals_reinforced')
      report.confirmations += count(out, 'confirmations')
      report.refused += count(out, 'refused')
      report.blocked += count(out, 'blocked')
    }
  } catch (e) {
    report.error = describeError(e)
  }

  // Close on every path: a run with no finished_at stays in flight and keeps its fence open.
  try {
    const res = await send(
      `/admin/ingest/runs/${runId}/close`,
      {
        files_seen: files,
        entries_seen: seen,
        proposals_new: report.proposalsNew,
        proposals_reinforced: report.proposalsReinforced,
        confirmations: report.confirmations,
      },
      CLOSE_TIMEOUT_MS,
    )
    if (!res.ok && report.error === undefined) report.error = failure(res.status, res.text)
  } catch (e) {
    if (report.error === undefined) report.error = describeError(e)
  }
  return report
}

/** A call that outlived its bound; the message names the call. */
class ImportTimeout extends Error {}
