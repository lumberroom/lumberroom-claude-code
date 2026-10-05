# Changelog

## [Unreleased]

### Removed

- The `server`, `mcpHost` and `baseUrl` options. Install asks for no host: `.mcp.json` connects to
  `https://mcp.lumberroom.cloud/mcp`. For a self-hosted engine, register it as an MCP server named
  `lumberroom`; the plugin falls back to it. The README's Self-hosted engine section has the command.

### Changed

- `/lr-import` uses the lumberroom CLI's login when `ingestToken` is empty, and posts to the engine
  the CLI points at. Run `lumberroom login` and pick the Full profile, which carries `mayIngest`.
- The README shows how to set or change `ingestToken`, which `/config` does not list.

## [0.4.0] - 2026-10-04

### Removed

- The `classic.SessionStart` hook that cut the old `lumberroom bootstrap --hook` block out of the
  SessionStart context. The plugin directory holds any mod that changes a `classic.*` result, so
  the plugin now passes that event through untouched. If you still run the old shell hook, remove
  it from `~/.claude/settings.json`, or the session gets the digest twice. The digest cache stays:
  it fills the section when the bootstrap fails.

### Changed

- The README says which tools the plugin calls itself and when, what the `tool.call` hook does
  with the calls it sees, the three `POST` requests `/lr-import` makes and to which host, and what
  the plugin reads from the conversation and your machine and where it goes.

## [0.3.2] - 2026-10-04

### Added

- `skills/lumberroom-memory`, the memory rules as a skill: bootstrap at the start, search before
  assuming, write durable facts without asking, and leave review and delete to the user. Since
  engine #96 the MCP server's descriptions give no orders, so in Cowork, where the plugin's hooks
  do not run, the skill is what carries them. The text is the engine's
  `client/skills/lumberroom-memory/SKILL.md`.

## [0.3.1] - 2026-10-04

### Changed

- `mcpHost` replaces `mcpUrl`. It defaults to `mcp.lumberroom.cloud`, and the bundled MCP server
  connects to `https://<mcpHost>/mcp`, so a self-hosted engine still needs one setting. `.mcp.json`
  now spells the scheme out, which the awesome-ai-plugins source scan requires: it rejected a URL
  that was a bare `${user_config.mcpUrl}`. If you set `mcpUrl`, set `mcpHost` to its host.
- `baseUrl` defaults to `https://<mcpHost>`.

### Added

- `SECURITY.md`, with private vulnerability reporting through GitHub.
- Weekly Dependabot updates for the npm development dependencies.
- A README section on each hook, the tools the plugin calls itself and the addresses it contacts.

### Fixed

- The importer's byte-order-mark strip wrote U+FEFF as a literal character, which the directory's
  validation holds for review. It is now an escape.

## [0.3.0] - 2026-10-02

### Changed

- The plugin no longer allows its own calls through the permission check. Anthropic's directory does
  not list a mod whose `tool.check` hook answers `allow`, so your permission rules now decide. Allow
  `context_bootstrap`, `memory_search` and `memory_write` once, as `docs/permissions.md` shows.
- `extractor` drops its `options` list, which the directory does not accept yet; any value other
  than `turn` or `session-end` still reads as `off`.

### Added

- `docs/permissions.md`, the rules to add for each name lumberroom can run under.
- One toast a session when your permission rules refuse the plugin's calls, linking to that page.

## [0.2.2] - 2026-10-02

### Added

- Directory listing fields in `plugin.json`: `displayName`, the lumberroom icon (`assets/icon.png`),
  homepage, documentation, support, privacy policy and terms URLs, and keywords.
- A README section on what the plugin sends and where.
- `mcpUrl` option: the bundled MCP server's URL, `https://mcp.lumberroom.cloud/mcp` by default.

### Changed

- `baseUrl` defaults to empty and then takes `mcpUrl` without its trailing `/mcp`, so a self-hosted
  engine needs one setting.
- The plugin no longer ships `package-lock.json` (Claude Code installed its development
  dependencies on every install) or the `prototype/` probe, which stays at tag `v0.1.0`.

## [0.2.1] - 2026-10-02

### Fixed

- A claude.ai connector at the same URL can win Claude Code's duplicate check over the bundled
  server, which left the plugin calling names with no tools. In `auto` the plugin now asks
  `$.mcp.connect` which name the session runs the server under and calls that one, and its
  self-allow covers the name from the first call.
- With no server connected, the cached digest still fills the section, so a session whose old hook
  block was cut against the cache keeps its memory.

## [0.2.0] - 2026-10-02

### Added

- The plugin bundles its MCP server (`.mcp.json`), connecting to `<baseUrl>/mcp` with OAuth, so one
  install runs the whole system. Setting `baseUrl` points it at a self-hosted engine.

### Changed

- `server` defaults to `auto`: the bundled server, or a registered `lumberroom` when Claude Code
  hides the bundled one as a duplicate of the same URL.
- The not-connected check also matches Claude Code's wording for a hidden plugin server.

## [0.1.1] - 2026-10-02

### Fixed

- The old shell hook's digest stayed in the SessionStart context on every start, so the session
  carried the digest twice. Claude Code runs that hook before the session exists, when an MCP call
  fails, so the plugin now caches each digest in `$.store` per project and cuts the old block
  against the cached copy. A failed bootstrap fills the section from the same cache. The first
  session for a project has no cache and keeps the old block once.

## [0.1.0] - 2026-10-02

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
- A token estimate on the status line: the digest section, the reminder and recall blocks, and the
  results of the model's own lumberroom tool calls, at four characters a token. It draws at session
  start and on every prompt, and compaction and `/clear` zero the blocks and tools figures.
- A marketplace manifest, `.claude-plugin/marketplace.json` (marketplace `lumberroom`, plugin
  `lumberroom-memory`). `npm run validate` checks it and `plugin.json`.
- A `tool.check` hook that allows the plugin's own calls to `context_bootstrap`, `memory_search` and
  `memory_write`, and leaves the model's calls to the user's permission rules.

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
