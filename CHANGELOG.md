# Changelog

## [Unreleased]

### Added

- `recallExtraProjects` option: other project slugs to search with each prompt at full weight, through
  an explicit `namespaces` list on `memory_search`. An entry is a bare slug (every project) or
  `project=slug1+slug2` (only when the current project is `project`), because Claude Code reads
  plugin options from user, `--settings` or managed settings and never from project settings.
- The digest from `context_bootstrap` as a session section of the system prompt, with the write rule.
- Recall on each prompt through `memory_search`, deduplicated per session, capped, and failing open
  behind a timeout and a circuit breaker.
- Claude Code's built-in memory section dropped and its memory files guarded from the file tools.
- `/lr-import`, which sends existing memory files to the engine's proposal queue.
- An optional extractor, off by default, that writes facts with a duplicate guard and the
  supersedes retry.

### Changed

- `recall` defaults to off. The reminder (every `reviewInterval` prompts, default 8) no longer
  depends on it: it goes out with recall on or off, from the person's prompts only with slash
  commands excluded, in its own `<lumberroom-reminder>` wrapper when no recall block carries it.
  The reminder text now tells the model to search before assuming and to write afterward.
- `/lr-import all` no longer posts. It proposes a namespace per folder (a path decoded from the
  folder name, else one model guess, else `global`) and waits for `/lr-import confirm`,
  `confirm all` or `skip`; `/lr-import plan` shows the table again.

- Recall hits are fence-neutral: every `<` and `>` in stored text becomes `‹` and `›`.
- Recall drops hits below `recallMinSimilarity` (default 0.6) and skips prompts under 12 characters.
- `recallMaxChars` bounds the whole recall block, and a line that does not fit no longer stops the
  lines after it.
- A hit attaches again after `/clear` or a compaction.
- The write nudge keeps its interval when the search fails, and the bootstrap retry runs with
  `recall` off.
- The old hook's block is cut only once the plugin's own digest is stored.
- The extractor skips the plugin's recall rows, drops more credential shapes, and moves past a fact
  the engine refuses. Compaction waits at most 20 s for it.
- The project slug follows the engine's rule. The project folder name follows Claude Code 2.1.287.
- The guard resolves a new file's parent folder, covers `Grep` and `Glob`, and guards `MEMORY.md`
  only at `~/.claude/MEMORY.md` and in project memory folders.
- `/lr-import` bounds each call, refuses a plain-http engine URL, and reports confirmations.
