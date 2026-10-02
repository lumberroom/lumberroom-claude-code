# lumberroom for Claude Code

![lumberroom](assets/icon.png)

lumberroom as Claude Code's memory, built as a Claude Code mod (a plugin of function hooks). The
digest sits in the system prompt, a short reminder tells the model to search and to write, and
Claude Code's own file memory is switched off. Recall with each prompt is available and off by
default. It targets lumberroom.cloud or a self-hosted engine through an MCP server the plugin
brings with it. The live sessions listed below ran against the hosted engine.

Built for Claude Code. The digest, the reminder, the status line and the memory guard are Claude
Code hooks, so on claude.ai, the desktop app or Cowork only the bundled MCP server applies.

**Status:** 0.2. The Claude Code mod API is early access (built and observed on 2.1.287) and may
change between releases.

## What it does

- **The digest in the system prompt.** At session start the plugin calls `context_bootstrap` for the
  project and adds the digest and the write rule as one section of the system prompt. It does not
  edit `CLAUDE.md` or your settings. Once the plugin holds its own digest it cuts the shell hook's
  block out of the SessionStart context; until then the old block stays, so a failed bootstrap loses
  nothing. When `~/.claude/CLAUDE.md` or the project's `CLAUDE.md` already carries the write rule,
  the plugin leaves its own copy of the rule out of the section. The check reads
  `~/.claude/CLAUDE.md` and `<git root>/CLAUDE.md` (the working directory when there is no git root)
  for a `# Durable memory` heading followed by `memory_write`.
- **A reminder every `reviewInterval` prompts (8 by default).** The plugin adds one line
  that tells the model to call `memory_search` before it answers from assumption and `memory_write`
  after the exchange settles something. It works with recall on or off. Slash commands do not count.
- **Recall with each prompt, off by default.** Each recall block stays in context for every later
  turn and costs input tokens, and weak matches fill the context. Turn on `recall` and the plugin
  searches lumberroom with your prompt and attaches new hits for the model only. It skips prompts
  under 12 characters and drops hits whose similarity is below `recallMinSimilarity`. A hit goes
  out once, until `/clear` or a compaction empties the context that held it. The first prompt of a
  session can wait for the bootstrap plus the search (up to `bootstrapTimeoutMs` plus
  `recallTimeoutMs`); later prompts wait at most `recallTimeoutMs`. Three failures in a row pause
  recall for a minute.
- **One store.** Claude Code's built-in memory section leaves the system prompt. The plugin refuses
  `Read`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` on `~/.claude/MEMORY.md` and on anything
  under `~/.claude/projects/*/memory/`, and `Grep` and `Glob` whose `path` is inside that folder.
  `Bash` is not guarded: `cat` or `rm` on a memory file goes through. `/lr-import` sends what
  those files already hold to the engine's proposal queue for you to review.
- **A token counter on the status line.** The plugin draws an estimate, at four characters a token,
  of what lumberroom adds to the context: the digest section, the reminder and recall blocks, and
  the results of the model's own lumberroom tool calls. The line reads `lumberroom ~2.4k tokens in
  context: digest 2.0k, reminders 30, tools 400 (2 calls)`. `session.start` and every prompt redraw
  it. Compaction and `/clear` zero the reminders and tools figures.

The plugin writes nothing on its own unless you turn on the extractor. When on, the extractor calls
`memory_write` directly. Otherwise the model writes when it calls `memory_write`.

## What it sends, and where

The plugin talks to one place: the lumberroom engine at `mcpUrl` (lumberroom.cloud by default, or
your own). It sends nothing to any other server. What goes there:

- **At session start:** a `context_bootstrap` call with the project slug (the git root's folder
  name). The engine answers with the digest.
- **With each prompt, only when `recall` is on:** a `memory_search` call carrying the prompt text,
  clipped, and the project slug.
- **When the extractor is on:** facts a model pulled from the conversation, sent with
  `memory_write`, each preceded by a `memory_search` for similar rows. The extraction itself runs
  on your Claude account through Claude Code, with no third party involved.
- **On `/lr-import`:** the contents of Claude Code's memory files under `~/.claude/projects/`, posted
  to the engine's proposal queue with your `ingestToken`. Nothing is posted until you run the
  command, and `/lr-import all` posts nothing until you confirm a folder.
- **The model's own calls:** when Claude calls `memory_search`, `memory_write` or another lumberroom
  tool, those calls go to the same engine under your permission rules.

On your machine the plugin reads `~/.claude/CLAUDE.md` and the project's `CLAUDE.md` (to see whether
they already carry the write rule) and keeps a digest cache, a duplicate guard for writes and the `/lr-import` plan in Claude Code's
plugin storage. It writes no files of its own. The hosted service's privacy policy is
https://lumberroom.cloud/privacy; a self-hosted engine keeps everything on your own server.

## Requirements

- Built on Claude Code 2.1.287.
- A lumberroom account on lumberroom.cloud, or a self-hosted engine.

## Install

From the marketplace:

```
/plugin marketplace add lumberroom/lumberroom-claude-code
/plugin install lumberroom-memory@lumberroom
```

The plugin brings its own MCP server, connecting to `mcpUrl`. Run `/mcp` once and sign in
to `plugin:lumberroom-memory:lumberroom`. Its tools appear as
`mcp__plugin_lumberroom-memory_lumberroom__memory_search` and so on, so a permission rule or agent
definition that names `mcp__lumberroom__*` needs the new names.

For a self-hosted engine, set `mcpUrl` to its `/mcp` endpoint (`claude plugin configure
lumberroom-memory@lumberroom --values-stdin` with `{"mcpUrl": "https://lr.example.com/mcp"}`, or
`/plugin configure`) and restart Claude Code. An engine that accepts only static bearer tokens needs its own registered server
instead: `claude mcp add --transport http lumberroom <url>/mcp --header "Authorization: Bearer
<token>"`.

If you already registered a server at the same URL, or your claude.ai account has a connector for
it, Claude Code keeps one copy and hides the others. The plugin asks which copy is live and talks
to it. Remove a registered one (`claude mcp remove lumberroom`) to run on the
bundled server alone.

The manifest is `.claude-plugin/marketplace.json` (marketplace `lumberroom`, plugin
`lumberroom-memory`, source `./`). `npm run validate` checks it and `plugin.json`.

From a local checkout, in a terminal:

```
claude --plugin-dir /path/to/lumberroom-claude-code
```

or, for development, link the folder into a session's mods folder
(`~/.claude/dev-mods/<session>/lumberroom-memory`) and accept hot reloading when Claude Code asks.

Claude Code runs the plugin's own calls to `context_bootstrap`, `memory_search` and `memory_write`
through your permission rules, so allow those three tools once: [docs/permissions.md](docs/permissions.md)
has the rules to add. Until you do, the session starts without the digest and the plugin shows a
toast that links to the page.

## Options

Set them in `/config`, or under `pluginConfigs["lumberroom-memory"].options` in
`~/.claude/settings.json`.

| Option | Default | Range | Meaning |
| --- | --- | --- | --- |
| `server` | `auto` |  | `auto` uses the bundled server, or a registered `lumberroom` when Claude Code hides the bundled one; else the server's name as `/mcp` lists it |
| `mcpUrl` | `https://mcp.lumberroom.cloud/mcp` |  | where the bundled MCP server connects; restart after a change |
| `baseUrl` | empty |  | engine URL for `/lr-import`; empty takes `mcpUrl` without the trailing `/mcp` |
| `project` | `auto` |  | `auto` uses the git root's folder name; `none` sends none; else the slug |
| `recall` | off |  | search with each prompt; costs input tokens on every later turn |
| `recallExtraProjects` | empty |  | other project slugs to search with each prompt, separated by commas or whitespace. A bare slug applies everywhere; `project=slug1+slug2` applies only in that project, for example `lumberroom-cloud=lumberroom` for a fork that shares its engine's decisions. Claude Code reads plugin options from user, `--settings` or managed settings only, never project settings, so a per-project value goes inside the option |
| `recallLimit` | 6 | 1 to 20 | hits asked for |
| `recallMaxChars` | 4000 | 500 to 16000 | cap on the whole recall block: tags, note, hits and write reminder |
| `recallMinSimilarity` | 0.6 | 0 to 1 | drop hits below this similarity; hits with no similarity pass |
| `recallTimeoutMs` | 2500 | 500 to 8000 | wait for `memory_search` |
| `bootstrapTimeoutMs` | 4000 | 500 to 8000 | wait for `context_bootstrap` |
| `digestMaxChars` | 8000 | 1000 to 30000 | cap on the digest section |
| `reviewInterval` | 8 | 0 to 100 | search and write reminder every N prompts, recall on or off; 0 is off |
| `replaceBuiltinMemory` | on |  | drop built-in memory and guard its files |
| `extractor` | `off` | `off`, `turn`, `session-end` | `turn` or `session-end` to write facts automatically |
| `extractorModel` | `haiku` |  | model for the extractor |
| `ingestToken` | unset |  | bearer with `mayIngest`, for `/lr-import`; kept in secure storage |

Numeric options are rounded to whole numbers and clamped to the range; a non-numeric value falls back to the default. `recallMinSimilarity` is clamped but not rounded.

## Commands

An option edited in `~/.claude/settings.json` by hand takes effect after `/reload-plugins`; a change
through `/config` reloads the plugin itself.

- `/lr-import`: send this project's memory files to the proposal queue. Needs `ingestToken` and an
  https `baseUrl` (http only for `localhost` and `127.0.0.1`). Each call waits 15 s, the closing
  call 5 s, and the result line reports posted, new, reinforced, confirmed, refused and blocked
  counts. `user` and `feedback` memories always go to `user:me`.
- `/lr-import all`: lists every folder under `~/.claude/projects` that has memory files and
  proposes a namespace for each, in a numbered table. It posts nothing. A folder whose name decodes
  to an existing path takes that path's git root slug; any other folder gets one model guess
  (`extractorModel`), and an unusable answer becomes `global`.
- `/lr-import confirm <n|folder> [namespace]`: posts that one folder with the proposed namespace, or
  the one you give (`my-repo`, `project:my-repo` or `global`). `/lr-import confirm all` posts every
  pending folder with its proposal. `/lr-import skip <n>` drops one. `/lr-import plan` shows the
  table again. Only these project and reference memories use the namespace; the plan needs no token,
  `confirm` does.

## Implemented versus verified

Everything above is implemented. `npm run gate` passes with 517 tests, a unit-level result: it covers
the logic and the hooks `claude plugin test` can reach. A unit test does not show that a live session
behaves the same way, so this section lists what a live Claude Code 2.1.287 session has shown.

Observed in a live 2.1.287 session:

- Recall attached on 10 of 10 headless turns.
- The guard refused a `Write` to a memory file in an interactive session.
- The old hook's block was removed from the SessionStart context in a headless run.
- `/lr-import` with no `ingestToken` answered with the setting hint and posted nothing, in an interactive session.
- `/lr-import all` listed the one folder holding memory files and proposed `project:lr-import-test` from the path it found; `/lr-import confirm 1` posted 3 proposals (3 new) to the ingest queue with the expected namespaces (2 under the project, 1 under `user:me`), and a second `confirm 1` posted nothing. The `ingestToken` was read from `pluginConfigs` in `~/.claude/settings.json`.
- Recall in an interactive session attached one hit to a prompt about the import command, where the same session attached five unrelated hits before the relevance floor existed.
- Compaction, on 2 October 2026: after a manual `/compact` in an interactive session, the digest section (the `# Durable memory (lumberroom)` heading, the project line and the engine digest) was still in the system prompt. The plugin's keep-facts line appeared in the compaction instructions. The reminder arrived on the 8th person prompt after compaction, so the prompt counter reset. The extractor was off, so no extraction ran.
- The write rule was left out of the section because `~/.claude/CLAUDE.md` already carries a `# Durable memory` block. Claude Code's own memory section was absent.
- Recall depends on query wording. `Cloudflare D1 port` surfaced the right memory at similarity 0.77; a bare `D1 decision` did not. Put the subject in the prompt.

## Roadmap

UI work is tracked in [issue #1](https://github.com/lumberroom/lumberroom-claude-code/issues/1): a
recall-and-why pane, a cost and latency band, and `/lr-asof`. The token status line is the first
piece. Toasts are dropped from the plan. Engine proposals P1 to P8 are in [docs/spec.md](docs/spec.md).

## Develop

```
npm install          # TypeScript, for type-checking only
npm run gate         # validates both manifests, tsc, claude plugin test (517 tests on 2 October 2026)
```

Design and measurements: [docs/spec.md](docs/spec.md). Task order: [docs/plan.md](docs/plan.md).

## License

Apache-2.0.
