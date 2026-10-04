// Wiring only: every decision lives in ../src and every session value lives in $.state. The
// closure variables below reset on a hot reload, which is safe because session.start runs again
// on a reload and recomputes them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { allow, CLOSED, failure, success } from '../src/breaker'
import { DEFAULTS, extrasFor, readConfig } from '../src/config'
import type { Config } from '../src/config'
import { afterContextReset, estimateTokens, formatStatus, isServerTool, NO_COST } from '../src/cost'
import type { Cost } from '../src/cost'
import { buildSection, digestFrom, hasDurableMemoryBlock, SECTION_ID } from '../src/digest'
import { buildExtractPrompt, buildJudgePrompt, parseFacts, parseJudge, turnsFrom } from '../src/extractor'
import type { Turn } from '../src/extractor'
import { GUARD_REASON, GUARDED_TOOLS, isBuiltinMemoryPath, normalizePath, parentOf, pathArg } from '../src/guard'
import { checkBaseUrl, parseMemoryFile, postProposals, PROJECT_DIR_KEPT, projectDirMatches, projectDirName, toProposalFacts } from '../src/importer'
import type { ImportReport, MemoryFile } from '../src/importer'
import {
  buildNamespacePrompt, decodeProjectDir, formatPlan, IMPORT_USAGE, namespaceLabel, parseImportArgs, parseNamespaceAnswer, parseNamespaceOverride, parsePlan, PLAN_KEY,
} from '../src/importplan'
import type { PlanEntry } from '../src/importplan'
import { callTool, isOutage } from '../src/mcp'
import { OWN_PLUGIN } from '../src/own'
import { raceSleep } from '../src/race'
import type { CallOutcome, McpDeps } from '../src/mcp'
import { BUNDLED_KEY, serverCandidates } from '../src/server'
import { findGitRoot, resolveProject, slugFromPath } from '../src/project'
import type { Exists } from '../src/project'
import { buildRecallBlock, buildReminderBlock, clipQuery, hitsFrom, isEligible, isPersonPrompt, nudgeDue, PERMISSION_TOAST, searchNamespaces, selectHits, toRecalled, UNREACHABLE_TOAST } from '../src/recall'
import { writeFact } from '../src/writes'
import type { Conflict, Fact, WriteDeps } from '../src/writes'
import type { LumberroomDigest } from '../types'

type Dollar = EngineInterface

const PLUGIN = OWN_PLUGIN

/** Spec 9.4. Compaction drops detail the extractor and the model have not yet written down. */
export const COMPACT_LINE =
  'Keep every decision, preference and durable fact the conversation established, with its identifiers, and note which were written to lumberroom.'

// `claude plugin validate` reads these keys as literals, so each ref is spelled out here.
const digestRef = atom({ plugin: 'lumberroom-memory', key: 'digest' } as const, null)
const seenRef = atom({ plugin: 'lumberroom-memory', key: 'seen' } as const, [])
const promptsRef = atom({ plugin: 'lumberroom-memory', key: 'prompts' } as const, 0)
const breakerRef = atom({ plugin: 'lumberroom-memory', key: 'breaker' } as const, CLOSED)
const lastRecallRef = atom({ plugin: 'lumberroom-memory', key: 'lastRecall' } as const, null)
const statsRef = atom(
  { plugin: 'lumberroom-memory', key: 'stats' } as const,
  { recalls: 0, hitsAttached: 0, lastMs: null, offline: false, writes: 0 },
)
const extractedRef = atom({ plugin: 'lumberroom-memory', key: 'extractedThrough' } as const, 0)
const costRef = atom({ plugin: 'lumberroom-memory', key: 'cost' } as const, NO_COST)

/** A session end gets about 1.5 s for the whole chain; a model call needs more than this. */
const SESSION_END_MIN_MS = 1000
const EXTRACT_MODEL_TIMEOUT_MS = 30_000
const JUDGE_MODEL_TIMEOUT_MS = 8_000
const WRITE_TIMEOUT_MS = 5_000
/** Compaction waits this long, in all, for the extractor before it goes on without it. */
const COMPACT_EXTRACT_BOUND_MS = 20_000
/** A stored row at or above this similarity is a candidate old version of a new fact. Lower scores cost a judge call and mostly name unrelated rows. */
const SIMILAR_MIN = 0.75

const mcpDeps = ($: Dollar): McpDeps => ({
  call: (server, tool, args) => $.mcp.call(server, tool, args),
  sleep: (ms) => $.clock.sleep(ms),
  now: () => $.clock.now(),
})

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

let cfg: Config = DEFAULTS

// Reset on every load: register() sets cfg, and session.start recomputes the rest.
let hasRule = false
/**
 * True while the last engine call said the server is not connected: the digest section and the
 * extractor stay off, and the next prompt tries again. Any other answer clears it.
 */
let serverAbsent = false
/** Prompts in a row that found no connected server. The third toasts and stops the calls. */
let notConnectedPrompts = 0
/** Set by the third such prompt; only the next session.start clears it. */
let recallStopped = false
let toldNotConnected = false
/** The permissions toast goes out once a session. */
let toldDenied = false
/** The candidate that last answered context_bootstrap; the other calls go to it. */
let activeServer: string | undefined
const serverName = (): string => activeServer ?? serverCandidates(cfg.server)[0] ?? cfg.server
/** Every name the plugin may call lumberroom under, for the token count. */
const knownServers = (): string[] => [...new Set([...serverCandidates(cfg.server), ...triedServers])]
/** Names serversToTry returned, counted before the first call answers. */
let triedServers: readonly string[] = []

/**
 * The names to try, in order. In auto, $.mcp.connect on the bundled key answers with the name the
 * session runs the server under (the bundled one, a registered duplicate, or a claude.ai connector
 * with the same URL), and that name goes first.
 */
const serversToTry = async ($: Dollar): Promise<readonly string[]> => {
  const base = serverCandidates(cfg.server)
  if (cfg.server !== 'auto') return base
  try {
    const raced = await raceSleep($.mcp.connect(BUNDLED_KEY), (ms) => $.clock.sleep(ms), cfg.bootstrapTimeoutMs)
    const answer = raced.timedOut ? undefined : raced.value
    if (answer?.isConnected === true) {
      const live = answer.server
      return [live, ...base.filter((n) => n !== live)]
    }
  } catch (err) {
    debug($, `$.mcp.connect failed: ${messageOf(err)}`)
  }
  return base
}

/** Gap between bootstrap attempts at session start, while MCP servers are still connecting. */
const BOOTSTRAP_RETRY_MS = 500
let isExtracting = false
let projectMemo: { cwd: string; slug: string | undefined } | undefined
const logged = new Set<string>()

/** The first failure of a hook shows in the transcript; the rest go to the debug log. */
const logFailure = ($: Dollar, hook: string, err: unknown): void => {
  const text = `lumberroom: ${hook} failed, going on without it: ${messageOf(err)}`
  try {
    if (logged.has(hook)) $.ui.log(text, { to: 'debug' })
    else {
      logged.add(hook)
      $.ui.log(text)
    }
  } catch {
    // A failing log must not become the failure.
  }
}

const debug = ($: Dollar, text: string): void => {
  try {
    $.ui.log(`lumberroom: ${text}`, { to: 'debug' })
  } catch {
    // As above.
  }
}

const homeDir = async ($: Dollar): Promise<string> => {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return home.replace(/[\\/]+$/, '')
}

const existsOn = ($: Dollar): Exists => async (path) => {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

const readText = async ($: Dollar, path: string): Promise<string> => {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

const projectFor = async ($: Dollar): Promise<string | undefined> => {
  const cwd = await $.session.cwd()
  if (projectMemo?.cwd === cwd) return projectMemo.slug
  const slug = await resolveProject(cfg.project, cwd, existsOn($))
  projectMemo = { cwd, slug }
  return slug
}

/** True when the breaker lets a call go out now; stores the reset state of a cooled breaker. */
const gate = async ($: Dollar): Promise<boolean> => {
  const now = await $.clock.now()
  const held = await read($, breakerRef)
  const verdict = allow(held, now)
  if (verdict.state.failures !== held.failures || verdict.state.openedAt !== held.openedAt) {
    await update($, breakerRef, () => verdict.state)
  }
  return verdict.allowed
}

/** Feeds one engine outcome to the breaker and the stats; toasts once per outage. */
const record = async ($: Dollar, outcome: CallOutcome): Promise<void> => {
  if (isOutage(outcome)) {
    const now = await $.clock.now()
    const held = await read($, breakerRef)
    const verdict = failure(held, now)
    await update($, breakerRef, () => verdict.state)
    await update($, statsRef, (s) => ({ ...s, offline: true }))
    if (verdict.startsOutage) $.ui.toast(UNREACHABLE_TOAST)
    return
  }
  if (outcome.kind === 'ok' || outcome.kind === 'tool_error') {
    const held = await read($, breakerRef)
    if (held.failures !== 0 || held.openedAt !== null) await update($, breakerRef, () => success())
    const stats = await read($, statsRef)
    if (stats.offline) await update($, statsRef, (s) => ({ ...s, offline: false }))
    return
  }
  if (outcome.kind === 'not_connected') {
    debug($, `the engine is not connected: ${outcome.error}`)
    return
  }
  debug($, `the permission check refused an engine call: ${outcome.kind === 'denied' ? outcome.error : ''}`)
  if (!toldDenied) {
    toldDenied = true
    $.ui.toast(PERMISSION_TOAST, { timeoutMs: 12_000 })
  }
}

/** Applies `change` to the token estimate and shows the result on the status line. */
const addCost = async ($: Dollar, change: (c: Cost) => Cost): Promise<void> => {
  try {
    $.ui.status(formatStatus(await update($, costRef, change)))
  } catch (err) {
    logFailure($, 'status line', err)
  }
}

const sectionText = async ($: Dollar): Promise<string> => {
  const digest = await read($, digestRef)
  return buildSection(digest?.text ?? '', { includeRule: !hasRule, maxChars: cfg.digestMaxChars, project: digest?.project ?? null })
}

/** Forgets which hits this conversation has seen, and restarts the nudge count. */
const resetDedup = async ($: Dollar): Promise<void> => {
  try {
    await update($, seenRef, () => [])
    await update($, promptsRef, () => 0)
  } catch (err) {
    logFailure($, 'dedup reset', err)
  }
  await addCost($, afterContextReset)
}

/** One prompt found no connected server. No breaker failure: the server is absent, not down. */
const noteNotConnectedPrompt = ($: Dollar): void => {
  serverAbsent = true
  notConnectedPrompts += 1
  if (notConnectedPrompts < 3 || toldNotConnected) return
  toldNotConnected = true
  recallStopped = true
  const names = serverCandidates(cfg.server).map((n) => `"${n}"`).join(' or ')
  $.ui.toast(`${PLUGIN}: no ${names} MCP server with memory tools is connected. Check /mcp, or the server option.`)
}

/** One context_bootstrap through the breaker. Stores the digest on success. */
const bootstrap = async ($: Dollar): Promise<'ok' | 'not_connected' | 'failed'> => {
  const project = await projectFor($)
  // Claude Code suppresses the bundled server when a registered one has its URL, and that one
  // answers instead; the first candidate that is connected becomes the server for the session.
  const candidates = await serversToTry($)
  triedServers = candidates
  let outcome: CallOutcome = { kind: 'not_connected', error: 'no server tried', ms: 0 }
  for (const candidate of candidates) {
    outcome = await callTool(mcpDeps($), candidate, 'context_bootstrap', project === undefined ? {} : { project }, cfg.bootstrapTimeoutMs)
    if (outcome.kind !== 'not_connected') {
      activeServer = candidate
      break
    }
  }
  await record($, outcome)
  serverAbsent = outcome.kind === 'not_connected'
  if (outcome.kind !== 'ok') {
    debug($, `context_bootstrap gave ${outcome.kind}${"error" in outcome ? `: ${outcome.error}` : ""}`)
    return outcome.kind === 'not_connected' ? 'not_connected' : 'failed'
  }
  const { text, memories } = digestFrom(outcome.data)
  const before = await read($, digestRef)
  const fetchedAt = await $.clock.now()
  const fresh = { project: project ?? null, text, memories, fetchedAt }
  await update($, digestRef, () => fresh)
  try {
    if (text.trim() !== '') await $.store.set(cacheKey(project), fresh)
  } catch (err) {
    logFailure($, 'digest cache', err)
  }
  // The section text is cached per project; a different project needs a fresh render.
  // A section rendered before the digest arrived is cached without it.
  if (before === null || before.project !== (project ?? null)) $.ui.invalidate('prompt.section')
  return 'ok'
}

/** The last digest fetched for a project, kept across sessions in $.store. It fills the section when the fresh bootstrap fails. */
const cacheKey = (project: string | undefined): string => `digest-cache:${project ?? '-'}`

const cachedDigest = async ($: Dollar): Promise<LumberroomDigest | null> => {
  try {
    const v = (await $.store.get(cacheKey(await projectFor($)))) as Partial<LumberroomDigest> | null | undefined
    if (typeof v?.text !== 'string' || v.text.trim() === '') return null
    return { project: typeof v.project === 'string' ? v.project : null, text: v.text, memories: typeof v.memories === 'number' ? v.memories : null, fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0 }
  } catch {
    return null
  }
}

/**
 * Session start races the MCP connections: the server answers "no tool ... on a server named" for
 * a moment and then connects. Retry for bootstrapTimeoutMs in total; a server that is still absent
 * leaves the digest unset and the first prompt tries again.
 */
const bootstrapAtStart = async ($: Dollar): Promise<void> => {
  const began = await $.clock.now()
  while ((await bootstrap($)) === 'not_connected') {
    if ((await $.clock.now()) - began >= cfg.bootstrapTimeoutMs) return
    await $.clock.sleep(BOOTSTRAP_RETRY_MS)
  }
}






/**
 * The digest, fetched now when session start missed it. Runs before the recall gate so a server
 * that connected late still gets its digest with recall off. Answers 'not_connected' when the
 * server is absent; any other answer lets the caller go on.
 */
const ensureDigest = async ($: Dollar): Promise<'ok' | 'not_connected'> => {
  if ((await read($, digestRef)) !== null) return 'ok'
  if (!(await gate($))) return 'ok'
  return (await bootstrap($)) === 'not_connected' ? 'not_connected' : 'ok'
}

const recallBlock = async ($: Dollar, text: string, originKind: string | undefined): Promise<string> => {
  if (recallStopped || !isPersonPrompt(text, originKind)) return ''
  if ((await ensureDigest($)) === 'not_connected') {
    noteNotConnectedPrompt($)
    return ''
  }

  // The reminder keeps its own interval and does not depend on recall: every prompt from the person
  // counts, a short one too. With no search to ride on it goes out in its own wrapper, since the
  // recall wrapper's data note would tell the model to ignore it (spec 9.2).
  const prompts = await update($, promptsRef, (n) => n + 1)
  const nudge = nudgeDue(prompts, cfg.reviewInterval)
  if (!cfg.recall || !isEligible(text, originKind)) return nudge ? buildReminderBlock() : ''

  // A search that fails still carries the reminder, in the recall block with its data note.
  const nudgeOnly = buildRecallBlock('', nudge)
  if (!(await gate($))) return nudgeOnly

  const project = await projectFor($)
  const query = clipQuery(text)
  const args: Record<string, unknown> = { query, limit: cfg.recallLimit }
  if (project !== undefined) args.project = project
  const namespaces = searchNamespaces(project, extrasFor(cfg.recallExtraProjects, project))
  if (namespaces !== undefined) args.namespaces = namespaces
  const outcome = await callTool(mcpDeps($), serverName(), 'memory_search', args, cfg.recallTimeoutMs)
  await record($, outcome)
  if (outcome.kind === 'not_connected') {
    noteNotConnectedPrompt($)
    return ''
  }
  if (outcome.kind !== 'ok') return nudgeOnly
  serverAbsent = false
  notConnectedPrompts = 0

  const hits = hitsFrom(outcome.data)
  const seen = new Set(await read($, seenRef))
  const { block, kept } = selectHits(hits, seen, { maxChars: cfg.recallMaxChars, nudge, minSimilarity: cfg.recallMinSimilarity })
  if (kept.length > 0) await update($, seenRef, (ids) => [...ids, ...kept.map((h) => h.id)])
  const at = await $.clock.now()
  await update($, lastRecallRef, () => ({ query, hits: kept.map(toRecalled), returned: hits.length, ms: outcome.ms, at }))
  await update($, statsRef, (s) => ({ ...s, recalls: s.recalls + 1, hitsAttached: s.hitsAttached + kept.length, lastMs: outcome.ms }))
  return buildRecallBlock(block, nudge)
}


/** Where a path lands once links resolve; undefined when it does not exist yet. */
const realPathOf = ($: Dollar, target: string): Promise<string | undefined> =>
  $.fs.stat(target, { resolve: true }).then(
    (s) => s.realPath,
    () => undefined,
  )

const guardsPath = async ($: Dollar, e: Readonly<Record<string, unknown>>): Promise<boolean> => {
  const tool = String(e.tool)
  if (!cfg.replaceBuiltinMemory || !GUARDED_TOOLS.has(tool)) return false
  const path = pathArg(tool, e)
  if (path === undefined) return false
  const home = await homeDir($)
  if (home === '') return false
  const spelled = normalizePath(path, home, await $.session.cwd())
  if (isBuiltinMemoryPath(spelled, home)) return true
  // A link outside the folder can lead into it; stat answers where the path lands.
  const real = await realPathOf($, path)
  if (real !== undefined) return isBuiltinMemoryPath(real, home)
  // A file about to be created has no stat; its folder may be the link.
  const split = parentOf(path.startsWith('~') || !path.startsWith('/') ? spelled : path)
  if (split === null || split.base === '' || split.base === '..') return false
  const realParent = await realPathOf($, split.parent)
  return realParent !== undefined && isBuiltinMemoryPath(`${realParent.replace(/\/+$/, '')}/${split.base}`, home)
}


/** Stored rows that read like `fact`; any failure answers [] so the write goes ahead plain. */
const findSimilarRows = async ($: Dollar, fact: Fact): Promise<Conflict[]> => {
  const outcome = await callTool(mcpDeps($), serverName(), 'memory_search', { query: fact.content, namespaces: [fact.namespace], limit: 3 }, cfg.recallTimeoutMs)
  if (outcome.kind !== 'ok') return []
  const out: Conflict[] = []
  for (const hit of hitsFrom(outcome.data)) {
    if (typeof hit.similarity === 'number' && hit.similarity >= SIMILAR_MIN) {
      out.push({ id: hit.id, namespace: typeof hit.namespace === 'string' ? hit.namespace : fact.namespace, content: hit.content, similarity: hit.similarity })
    }
  }
  return out
}

const extract = async ($: Dollar, signal?: AbortSignal): Promise<void> => {
  if (isExtracting) return
  isExtracting = true
  try {
    const all = await $.session.messages()
    let from = await read($, extractedRef)
    // The list shrinks after a /clear or a compaction; a stale index would skip new turns.
    if (from > all.length) from = 0
    // The plugin's own recall rows read as user turns; turnsFrom cuts them out.
    const turns: Turn[] = turnsFrom(all.slice(from))
    if (turns.length === 0) {
      if (from !== all.length) await update($, extractedRef, () => all.length)
      return
    }

    const project = (await projectFor($)) ?? null
    const asked = await $.model.complete(
      { model: cfg.extractorModel, prompt: buildExtractPrompt(turns, project), maxTokens: 2000, timeoutMs: EXTRACT_MODEL_TIMEOUT_MS },
      signal === undefined ? undefined : { signal },
    )
    if (!asked.isAnswered) {
      debug($, `the extractor model gave no answer: ${asked.reason}`)
      return
    }

    const deps: WriteDeps = {
      write: (args) => callTool(mcpDeps($), serverName(), 'memory_write', args, WRITE_TIMEOUT_MS),
      store: { get: (key) => $.store.get(key), set: (key, value) => $.store.set(key, value) },
      findSimilar: (fact) => findSimilarRows($, fact),
      isOldVersion: async (fact, conflict) => {
        const judged = await $.model.complete({ model: cfg.extractorModel, prompt: buildJudgePrompt(fact, conflict), maxTokens: 16, timeoutMs: JUDGE_MODEL_TIMEOUT_MS })
        return judged.isAnswered && parseJudge(judged.text)
      },
      now: () => $.clock.now(),
    }
    let written = 0
    let failed = 0
    for (const fact of parseFacts(asked.text, project)) {
      const result = await writeFact(deps, fact)
      if (result.status === 'written') written += 1
      if (result.status === 'refused') debug($, `the engine refused an extracted fact: ${result.error}`)
      if (result.status === 'failed') {
        failed += 1
        debug($, `an extracted fact was not written: ${result.error}`)
      }
    }
    if (written > 0) await update($, statsRef, (s) => ({ ...s, writes: s.writes + written }))
    // A timeout or an unreachable server keeps the range open; the duplicate guard stops the others
    // going out twice. A refused fact is terminal (the same text gets the same answer), so it
    // does not hold the window.
    if (failed === 0) await update($, extractedRef, () => all.length)
  } finally {
    isExtracting = false
  }
}

const extractInBackground = ($: Dollar): void => {
  // A dispatch's budget and signal end with it; a timer outlives it (reference.md, "Work that outlives a dispatch").
  $.clock.after(0, () => {
    extract($).catch((err: unknown) => logFailure($, 'extractor', err))
  })
}




const importHint = 'Set the Ingest token option of the lumberroom-memory plugin to a token that has the mayIngest grant, then run /lr-import again.'

/**
 * Which folders under ~/.claude/projects belong to the current project: its root, cwd and git
 * root, by name. A name over 200 characters carries a hash Claude Code adds, so those match on
 * their first 200 characters.
 */
const currentMatcher = async ($: Dollar): Promise<{ current: string[]; isCurrent: (entry: string) => boolean }> => {
  const cwd = await $.session.cwd()
  const root = await $.session.root().catch(() => cwd)
  const gitRoot = await findGitRoot(cwd, existsOn($))
  const current = [...new Set([projectDirName(root), projectDirName(cwd), ...(gitRoot === null ? [] : [projectDirName(gitRoot)])])]
  return { current, isCurrent: (entry) => current.some((name) => projectDirMatches(name, entry)) }
}

/** The current project's memory folders, found by listing ~/.claude/projects when a name is too long to spell. */
const currentFolders = async ($: Dollar, home: string): Promise<{ dir: string; slug: string | null }[]> => {
  const projects = `${home}/.claude/projects`
  const slug = (await projectFor($)) ?? null
  const { current } = await currentMatcher($)
  const listed = current.some((name) => name.length > PROJECT_DIR_KEPT) ? await $.fs.list(projects).catch(() => []) : []
  const names = listed.filter((entry) => entry.kind === 'dir').map((entry) => entry.name)
  const folders = new Set(current.flatMap((name) => (name.length > PROJECT_DIR_KEPT ? names.filter((entry) => projectDirMatches(name, entry)) : [name])))
  return [...folders].map((name) => ({ dir: `${projects}/${name}/memory`, slug }))
}

type FolderFiles = { path: string; file: MemoryFile }[]

/** The parseable memory files in one memory folder; [] when the folder is absent. */
const readMemoryFiles = async ($: Dollar, dir: string): Promise<FolderFiles> => {
  const listed = await $.fs.list(dir).catch(() => [])
  const files: FolderFiles = []
  for (const entry of listed) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    const path = `${dir}/${entry.name}`
    const file = parseMemoryFile(entry.name, await readText($, path))
    if (file !== null) files.push({ path, file })
  }
  return files
}

/** One ingest run for the given groups. The proposal facts are built inside the run, once its id exists. */
const postGroups = ($: Dollar, token: string, groups: { slug: string | null; files: FolderFiles }[], count: number) =>
  postProposals(
    {
      fetch: async (url, init) => {
        const r = await $.http.fetch(url, init)
        return { status: r.status, ok: r.ok, text: r.text }
      },
      sleep: (ms) => $.clock.sleep(ms),
    },
    cfg.baseUrl,
    token,
    async (runId) => (await Promise.all(groups.map((g) => toProposalFacts(g.files, g.slug, runId)))).flat(),
    count,
  )

const describeReport = (r: ImportReport): string =>
  `${r.posted} posted (${r.proposalsNew} new, ${r.proposalsReinforced} reinforced, ${r.confirmations} confirmed, ${r.refused} refused, ${r.blocked} blocked) from ${r.files} files`

/**
 * The namespace to propose for one folder. A folder name does not say where a path segment ends,
 * so the path is rebuilt first, with a bounded number of $.fs.exists probes, and its git root's
 * slug wins. Only a folder with no findable path costs a model call, since the answer would lose
 * to the path anyway. A bad model answer is global, never a guess the person did not see.
 */
const proposeNamespace = async ($: Dollar, folder: string, files: MemoryFile[]): Promise<Pick<PlanEntry, 'slug' | 'how' | 'reason'>> => {
  const exists = existsOn($)
  const decoded = folder.length > PROJECT_DIR_KEPT ? null : await decodeProjectDir(folder, exists)
  if (decoded !== null) {
    const root = (await findGitRoot(decoded, exists)) ?? decoded
    const slug = slugFromPath(root)
    if (slug !== '') return { slug, how: 'path', reason: root === decoded ? `found ${decoded}` : `found ${decoded}, git root ${root}` }
  }
  try {
    const asked = await $.model.complete({
      model: cfg.extractorModel,
      prompt: buildNamespacePrompt(folder, files),
      maxTokens: 32,
      timeoutMs: JUDGE_MODEL_TIMEOUT_MS,
    })
    if (!asked.isAnswered) return { slug: null, how: 'fallback', reason: `no path found and the model gave no answer (${asked.reason}), so global` }
    const answer = parseNamespaceAnswer(asked.text)
    if (answer === null) return { slug: null, how: 'fallback', reason: 'no path found and the model answered with something other than a slug or global, so global' }
    if (answer === 'global') return { slug: null, how: 'model', reason: 'no path found; the model judged these memories to belong to no one project' }
    return { slug: answer, how: 'model', reason: `no path found; the model proposed ${answer}` }
  } catch (err) {
    return { slug: null, how: 'fallback', reason: `no path found and the model call failed (${messageOf(err)}), so global` }
  }
}

/** Every folder under ~/.claude/projects with parseable memory files, in name order, each with a proposed namespace. */
const buildPlan = async ($: Dollar, home: string): Promise<PlanEntry[]> => {
  const projects = `${home}/.claude/projects`
  const listed = await $.fs.list(projects).catch(() => [])
  const names = listed.filter((entry) => entry.kind === 'dir').map((entry) => entry.name).sort()
  const slug = (await projectFor($)) ?? null
  const { isCurrent } = await currentMatcher($)
  const entries: PlanEntry[] = []
  for (const folder of names) {
    const files = await readMemoryFiles($, `${projects}/${folder}/memory`)
    if (files.length === 0) continue
    const chosen = isCurrent(folder)
      ? { slug, how: 'current' as const, reason: slug === null ? "this session's project (none is sent, so global)" : "this session's project" }
      : await proposeNamespace($, folder, files.map((f) => f.file))
    entries.push({ folder, files: files.length, ...chosen, status: 'pending' })
  }
  return entries
}

const NO_PLAN = 'lr-import: no plan yet. Run /lr-import all first.'

/** The plan row a `confirm` or `skip` target names: a 1-based number or an exact folder name. -1 when none. */
const findEntry = (entries: readonly PlanEntry[], target: string): number => {
  if (/^\d+$/.test(target)) {
    const i = Number(target) - 1
    return i >= 0 && i < entries.length ? i : -1
  }
  return entries.findIndex((e) => e.folder === target)
}

/** Posts one plan folder, with `slug` for its project and reference memories. */
const postFolder = async ($: Dollar, token: string, home: string, entry: PlanEntry, slug: string | null): Promise<{ ok: boolean; line: string }> => {
  const files = await readMemoryFiles($, `${home}/.claude/projects/${entry.folder}/memory`)
  const where = `${entry.folder} -> ${namespaceLabel(slug)}`
  if (files.length === 0) return { ok: false, line: `${where}: no memory files left to send` }
  const report = await postGroups($, token, [{ slug, files }], files.length)
  if (report.error !== undefined) return { ok: false, line: `${where}: stopped: ${report.error}. ${describeReport(report)}` }
  return { ok: true, line: `${where}: ${describeReport(report)}` }
}

const runConfirm = async ($: Dollar, token: string, home: string, target: string, namespace: string | undefined): Promise<string> => {
  const entries = parsePlan(await $.store.get(PLAN_KEY))
  if (entries.length === 0) return NO_PLAN
  const save = (): Promise<void> => $.store.set(PLAN_KEY, entries)

  if (target === 'all') {
    const lines: string[] = []
    let stopped = false
    for (const entry of entries) {
      if (entry.status !== 'pending') continue
      const result = await postFolder($, token, home, entry, entry.slug)
      lines.push(result.line)
      if (!result.ok) {
        stopped = true
        break
      }
      entry.status = 'done'
      await save()
    }
    if (lines.length === 0) return 'lr-import: nothing is pending. /lr-import plan shows the table.'
    const left = entries.filter((e) => e.status === 'pending').length
    const tail = stopped ? `Stopped at the first failure; ${left} still pending.` : 'They wait in the proposal queue for review.'
    return ['lr-import confirm all:', ...lines, tail].join('\n')
  }

  const i = findEntry(entries, target)
  const entry = entries[i]
  if (entry === undefined) return `lr-import: "${target.slice(0, 80)}" is not in the plan. /lr-import plan shows the table.`
  if (entry.status === 'done') return `lr-import: ${entry.folder} is already done. /lr-import all builds a new plan.`
  let slug = entry.slug
  if (namespace !== undefined) {
    const parsed = parseNamespaceOverride(namespace)
    if (!parsed.ok) return `lr-import: ${parsed.error}`
    slug = parsed.slug
  }
  const result = await postFolder($, token, home, entry, slug)
  if (!result.ok) return `lr-import: ${result.line}`
  entry.status = 'done'
  await save()
  return `lr-import: ${result.line}. They wait in the proposal queue for review.`
}

const runImport = async ($: Dollar, args: string): Promise<string> => {
  const cmd = parseImportArgs(args)
  if (cmd.kind === 'usage') return IMPORT_USAGE
  const token = cfg.ingestToken
  // Building, showing and skipping a plan make no network call, so they need no token.
  if (token === undefined && (cmd.kind === 'current' || cmd.kind === 'confirm')) return importHint
  const unsafe = checkBaseUrl(cfg.baseUrl)
  if (unsafe !== null && (cmd.kind === 'current' || cmd.kind === 'confirm')) return `lr-import: ${unsafe}`
  const home = await homeDir($)
  if (home === '') return 'lr-import: the home directory is unknown, so the memory folders cannot be found.'

  if (cmd.kind === 'build') {
    const entries = await buildPlan($, home)
    await $.store.set(PLAN_KEY, entries)
    return formatPlan(entries)
  }
  if (cmd.kind === 'plan') {
    const entries = parsePlan(await $.store.get(PLAN_KEY))
    return entries.length === 0 ? NO_PLAN : formatPlan(entries)
  }
  if (cmd.kind === 'skip') {
    const entries = parsePlan(await $.store.get(PLAN_KEY))
    if (entries.length === 0) return NO_PLAN
    const entry = entries[findEntry(entries, cmd.target)]
    if (entry === undefined) return `lr-import: "${cmd.target.slice(0, 80)}" is not in the plan. /lr-import plan shows the table.`
    if (entry.status === 'done') return `lr-import: ${entry.folder} is already done.`
    entry.status = 'skipped'
    await $.store.set(PLAN_KEY, entries)
    return `lr-import: skipped ${entry.folder}. /lr-import confirm ${cmd.target} still posts it if you change your mind.`
  }
  if (cmd.kind === 'confirm') return runConfirm($, token as string, home, cmd.target, cmd.namespace)

  const groups: { slug: string | null; files: FolderFiles }[] = []
  let count = 0
  for (const { dir, slug } of await currentFolders($, home)) {
    const files = await readMemoryFiles($, dir)
    if (files.length > 0) groups.push({ slug, files })
    count += files.length
  }
  if (count === 0) return 'lr-import: no memory files found to send.'

  const report = await postGroups($, token as string, groups, count)
  const counts = describeReport(report)
  if (report.error !== undefined) return `lr-import stopped: ${report.error}. ${counts}.`
  return `lr-import: ${counts}. They wait in the proposal queue for review.`
}


export const register: Register = (on, options) => {
  cfg = readConfig(options)

  // Resolves the person's project, fetches the digest and registers /lr-import.
  on('session.start', async ($, e, next) => {
    const res = await next(e)
    try {
      serverAbsent = false
      notConnectedPrompts = 0
      recallStopped = false
      toldNotConnected = false
      toldDenied = false
      projectMemo = undefined
      activeServer = undefined
      try {
        await $.command.register({ name: 'lr-import', description: "Send Claude Code's memory files to lumberroom's proposal queue", argumentHint: '[all | plan | confirm <n|folder|all> [namespace] | skip <n>]' })
      } catch (err) {
        logFailure($, 'command.register', err)
      }

      const home = await homeDir($)
      const root = (await findGitRoot(e.cwd, existsOn($))) ?? e.cwd
      const claudeMd = [home === '' ? '' : await readText($, `${home}/.claude/CLAUDE.md`), await readText($, `${root}/CLAUDE.md`)]
      hasRule = claudeMd.some(hasDurableMemoryBlock)

      await bootstrapAtStart($)
      // A failed bootstrap leaves the cached digest in the section.
      if ((await read($, digestRef)) === null) {
        const cached = await cachedDigest($)
        if (cached !== null) {
          await update($, digestRef, () => cached)
          $.ui.invalidate('prompt.section')
        }
      }
      // The engine caches the section, so prompt.compose may not run again after a reload; the
      // line has to be drawn here or it stays blank until a count changes.
      const section = serverAbsent ? 0 : estimateTokens(await sectionText($))
      await addCost($, (c) => ({ ...c, section }))
    } catch (err) {
      logFailure($, 'session.start', err)
    }
    return res
  })

  // The digest goes in the system prompt, once per render and cached. prompt.submit context would
  // persist in the transcript and be sent again on every later turn (spec 2.1).
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    try {
      if (res.sections.some((s) => s.id === SECTION_ID)) return res
      // With no server, a cached digest still fills the section.
      if (serverAbsent && (await read($, digestRef)) === null) return res
      const text = await sectionText($)
      await addCost($, (c) => ({ ...c, section: estimateTokens(text) }))
      if (text === '') return res
      return { sections: [...res.sections, { id: SECTION_ID, text, scope: 'session' as const }] }
    } catch (err) {
      logFailure($, 'prompt.compose', err)
      return res
    }
  })

  on('prompt.section', { name: 'memory' }, ($, e, next) => (cfg.replaceBuiltinMemory ? { text: null } : next(e)))

  // next() sits outside the try block: a failure beneath the plugin must not run the chain twice.
  on('prompt.submit', async ($, e, next) => {
    let block = ''
    try {
      block = await recallBlock($, e.text, e.origin?.kind)
    } catch (err) {
      logFailure($, 'prompt.submit', err)
    }
    // Every prompt redraws the line, so a status cleared by a reload comes back on the next prompt.
    await addCost($, (c) => (block === '' ? c : { ...c, blocks: c.blocks + estimateTokens(block) }))
    if (block === '') return next(e)
    return next({ ...e, context: [...(e.context ?? []), block] })
  })

  on('tool.call', async ($, e, next) => {
    let isDenied = false
    try {
      isDenied = await guardsPath($, e as unknown as Readonly<Record<string, unknown>>)
    } catch (err) {
      logFailure($, 'tool.call', err)
    }
    if (isDenied) return { deny: GUARD_REASON }
    // The model's own lumberroom calls; the plugin's $.mcp.call results never enter the transcript.
    if (!knownServers().some((server) => isServerTool(e.tool, server)) || next.origin.plugin === PLUGIN) return next(e)
    const res = await next(e)
    if (res.deny === undefined) await addCost($, (c) => ({ ...c, tools: c.tools + estimateTokens(res.text ?? ''), toolCalls: c.toolCalls + 1 }))
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    try {
      if (cfg.extractor === 'turn' && !serverAbsent && e.agentId === undefined && e.reason === 'answer') {
        // A review interval of 0 turns the nudge off; the extractor then runs at the default cadence.
        const every = cfg.reviewInterval > 0 ? cfg.reviewInterval : DEFAULTS.reviewInterval
        if ((await $.session.turns()) % every === 0) extractInBackground($)
      }
    } catch (err) {
      logFailure($, 'turn.complete', err)
    }
    return res
  })

  on('session.end', async ($, e, next) => {
    try {
      if (cfg.extractor === 'session-end' && !serverAbsent && next.budget.remainingMs >= SESSION_END_MIN_MS) {
        await extract($, next.signal)
      }
    } catch (err) {
      logFailure($, 'session.end', err)
    }
    const res = await next(e)
    // /clear starts a conversation with no session.start. Hits sent before it are gone from the
    // model's context, so they may attach again.
    if (e.reason === 'clear') await resetDedup($)
    return res
  })

  on('session.compact', async ($, e, next) => {
    try {
      if (cfg.extractor !== 'off' && !serverAbsent && e.agentId === undefined && e.trigger !== 'precompute') {
        // The model call takes a signal; the wait for it does not count against the hook budget,
        // so a hung call would hold compaction. On the bound the window stays where it was and the
        // next extraction reads those turns again.
        const stop = typeof AbortController === 'undefined' ? undefined : new AbortController()
        const raced = await raceSleep(extract($, stop?.signal), (ms) => $.clock.sleep(ms), COMPACT_EXTRACT_BOUND_MS)
        if (raced.timedOut) {
          stop?.abort()
          debug($, `the extraction before compaction passed ${COMPACT_EXTRACT_BOUND_MS} ms, compacting without it`)
        }
      }
    } catch (err) {
      logFailure($, 'session.compact', err)
    }
    const res = await next({ ...e, instructions: [e.instructions, COMPACT_LINE].filter(Boolean).join('\n\n') })
    // Compaction replaces the transcript that held the recall blocks, so they may attach again.
    // A precompute installs nothing, a veto leaves the transcript as it was, and a subagent's
    // compaction is not the main conversation's.
    if (e.trigger !== 'precompute' && e.agentId === undefined && res.skip === undefined) await resetDedup($)
    return res
  })

  on('command.run', { command: 'lr-import' }, async ($, e) => {
    try {
      return { text: await runImport($, e.args) }
    } catch (err) {
      logFailure($, 'command.run', err)
      return { text: `lr-import failed: ${messageOf(err)}` }
    }
  })
}
