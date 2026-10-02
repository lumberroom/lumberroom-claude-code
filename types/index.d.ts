// The $.state contract of the lumberroom-memory plugin. Values live for the session and survive a
// hot reload; module variables do not.

/** The circuit breaker, kept as plain data so a reload does not reset an open outage. */
export type LumberroomBreaker = {
  failures: number
  /** $.clock.now() milliseconds when the breaker opened; null while closed. */
  openedAt: number | null
}

export type LumberroomDigest = {
  /** The project slug the digest was fetched for; null when none was sent. */
  project: string | null
  /** The engine's rendered digest markdown (context_bootstrap's `text`). */
  text: string
  /** Total memories the engine reported (`counts.memories`), when present. */
  memories: number | null
  fetchedAt: number
}

/** One hit as the status line and the "why recalled" pane read it. */
export type LumberroomRecalledHit = {
  id: string
  namespace: string
  content: string
  source: string | null
  score: number | null
  similarity: number | null
  occurredAt: string | null
  createdAt: string | null
}

export type LumberroomRecall = {
  /** The prompt's query as sent, clipped. */
  query: string
  /** Hits attached to the prompt after dedup and the cap. */
  hits: LumberroomRecalledHit[]
  /** Hits the engine returned before dedup. */
  returned: number
  ms: number
  at: number
}

export type LumberroomStats = {
  recalls: number
  hitsAttached: number
  lastMs: number | null
  /** True from the first failure of an outage until the next success. */
  offline: boolean
  writes: number
}

declare module 'claude-code' {
  interface PluginState {
    'lumberroom-memory': {
      digest: LumberroomDigest | null
      /** Hit ids already attached this session, so a hit is sent once. */
      seen: string[]
      /** Prompts from the person this session (slash commands excluded), for the reminder interval. */
      prompts: number
      breaker: LumberroomBreaker
      lastRecall: LumberroomRecall | null
      stats: LumberroomStats
      /** Index into $.session.messages() the extractor last read up to. */
      extractedThrough: number
    }
  }
}
