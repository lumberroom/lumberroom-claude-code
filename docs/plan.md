# Plan

Spec: [spec.md](spec.md). Tasks run in this order. Each lists its files; no two tasks of one batch
share a file. `npm run gate` (validate, typecheck, `claude plugin test`) closes every batch.

## Batch 0: prototype and interface lock (done, 2 October 2026)

- P0.1 Probe mod and 10-turn driver: `prototype/`. Results in spec section 2.
- P0.2 Manifest with `userConfig`, `$.state` contract, typed stubs for every `src/` module,
  `package.json` (TypeScript 5.9.3 for `tsc` only), `tsconfig.json`, smoke test.

## Batch 1: logic and wiring (parallel)

| Task | Files | Tests |
| --- | --- | --- |
| T1 core | `src/config.ts`, `src/project.ts`, `src/breaker.ts`, `src/mcp.ts`, `src/recall.ts` | config, project, breaker, mcp (timeout race, three result shapes), recall (dedup, cap, fence strip, eligibility, nudge) |
| T2 prompt and files | `src/digest.ts`, `src/guard.ts`, `src/importer.ts` | old-hook stripping against the real CLI output shape, CLAUDE.md block detection, guard paths, memory-file parsing, proposal batching and 403 |
| T3 writes | `src/writes.ts`, `src/extractor.ts`, `scripts/capture-tools.mjs`, `scripts/snapshot-to-ts.mjs`, `tools-snapshot.json`, `tests/fixtures/tools-snapshot.ts`, `tests/drift.test.ts` | supersedes retry loop, live-head retry, duplicate guard across a retried timeout, fact parsing and the credential filter, drift of every argument the plugin sends |
| T4 wiring | `hooks/register.ts`, `tests/register.test.ts` | each hook through the test kit with `mcp.call` answered beneath the plugin |

## Batch 2: integrate and verify (lead)

- I1 `npm run gate` green.
- I2 Load in a hot-reloaded session (`~/.claude/dev-mods/<session>/lumberroom-memory` linked to the
  repo). Evidence: the system prompt section, a recall block in a transcript, the guard refusing a
  memory-file write, `/lr-import` refusing with no token, the old hook's digest gone.
- I3 Token growth over 10 turns with the plugin on, measured the way spec 2.1 measured the probe.
- I4 One blind reviewer pass over the diff.

## Batch 3: UI (Step 3), one at a time, each stopped for owner review

1. Status line: memories, hits this prompt, latency, offline.
2. Toasts: a `memory_write` the model made, and its `possible_conflicts`.
3. `/lr-review` pane over `review_queue` and `review_decide`, passing `version` back.
4. "Why recalled" pane: id, source, score, namespace, source agent per hit of the last prompt.
5. `/lr-asof`: needs `mayReadHistory`; reads `/admin/whoami` and degrades to a message without it.
6. Pending-writes inbox for extracted facts.
7. Secret and sensitivity guard on `memory_write` calls the model makes.
8. Cost and latency band above the prompt.
9. Stale-memory toast at session start.

## Publish (waits for the owner)

Create `lumberroom/lumberroom-claude-code` on GitHub, push, tag `v0.1.0`. Not before the owner says so.
