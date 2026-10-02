# Plan

Spec: [spec.md](spec.md). Tasks run in this order. Each lists its files; no two tasks of one batch
share a file. `npm run gate` (validate, typecheck, `claude plugin test`) closes every batch.
`validate` checks `plugin.json` and `marketplace.json`.

## Batch 0: prototype and interface lock (done, 2 October 2026)

- P0.1 Probe mod and 10-turn driver: `prototype/` at tag `v0.1.0`. Results in spec section 2.
- P0.2 Manifest with `userConfig`, `$.state` contract, typed stubs for every `src/` module,
  `package.json` (TypeScript 5.9.3 for `tsc` only), `tsconfig.json`, smoke test.

## Batch 1: logic and wiring (parallel; done, 2 October 2026)

Implemented; `npm run gate` passes with 517 tests. Later additions outside the table: `src/cost.ts`
(status line), `src/own.ts`, `src/race.ts`, `src/importplan.ts`, and
`.claude-plugin/marketplace.json`.

| Task | Files | Tests |
| --- | --- | --- |
| T1 core | `src/config.ts`, `src/project.ts`, `src/breaker.ts`, `src/mcp.ts`, `src/recall.ts` | config, project, breaker, mcp (timeout race, three result shapes), recall (dedup, cap, fence strip, eligibility, nudge) |
| T2 prompt and files | `src/digest.ts`, `src/guard.ts`, `src/importer.ts` | old-hook stripping against the real CLI output shape, CLAUDE.md block detection, guard paths, memory-file parsing, proposal batching and 403 |
| T3 writes | `src/writes.ts`, `src/extractor.ts`, `scripts/capture-tools.mjs`, `scripts/snapshot-to-ts.mjs`, `tools-snapshot.json`, `tests/fixtures/tools-snapshot.ts`, `tests/drift.test.ts` | supersedes retry loop, live-head retry, duplicate guard across a retried timeout, fact parsing and the credential filter, drift of every argument the plugin sends |
| T4 wiring | `hooks/register.ts`, `tests/register.test.ts` | each hook through the test kit with `mcp.call` answered beneath the plugin |

## Batch 2: integrate and verify (lead)

- I1 `npm run gate` green. Done: 517 tests pass.
- I2 Load in a hot-reloaded session (`~/.claude/dev-mods/<session>/lumberroom-memory` linked to the
  repo). Observed: the system prompt section, a recall block in a transcript, the guard
  refusing a memory-file write, `/lr-import` refusing with no token, the old hook's digest gone,
  compaction and the reminder counter (spec section 14).

## Batch 3: UI (Step 3), one at a time, each stopped for owner review

UI work is tracked in [issue #1](https://github.com/lumberroom/lumberroom-claude-code/issues/1).
Toasts were dropped on 2 October 2026.

1. Token status line: implemented and unit tested (`src/cost.ts`, commit
   `ffd6446`; spec section 13). Replaces the planned memories-hits-latency line.
2. Dropped: toasts for a `memory_write` and its `possible_conflicts`.
3. Issue #1: "why recalled" pane, with id, source, score, namespace and source agent per hit of the
   last prompt.
4. Issue #1: `/lr-asof`, which needs `mayReadHistory`, reads `/admin/whoami` and degrades to a message
   without it.
5. Issue #1: cost and latency band above the prompt.
6. Dropped: stale-memory toast at session start.

## Publish

- Repository `lumberroom/lumberroom-claude-code` created.
- `.claude-plugin/marketplace.json` added, `npm run validate` checks both manifests.
