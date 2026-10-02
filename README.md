# lumberroom for Claude Code

lumberroom as Claude Code's memory, built as a Claude Code mod (a plugin of function hooks). The
digest sits in the system prompt, a short reminder tells the model to search and to write, and
Claude Code's own file memory is switched off. Recall with each prompt is available and off by default. Works against lumberroom.cloud or a self-hosted engine, through the `lumberroom`
MCP server you already registered.

**Status:** 0.1.0, unreleased. The Claude Code mod API is early access (built against 2.1.287) and
may change between releases.

## What it does

- **The digest in the system prompt.** At session start the plugin calls `context_bootstrap` for the
  project and adds the digest and the write rule as one section of the system prompt. It does not
  edit `CLAUDE.md` or your settings. Once the plugin holds its own digest it cuts the shell hook's
  block out of the SessionStart context; until then the old block stays, so a failed bootstrap loses
  nothing. When `~/.claude/CLAUDE.md` or the project's `CLAUDE.md` already carries the write rule,
  the plugin leaves its own copy of the rule out of the section.
- **A reminder every 8 prompts.** Every `reviewInterval` prompts you send, the plugin adds one line
  that tells the model to call `memory_search` before it answers from assumption and `memory_write`
  after the exchange settles something. It works with recall on or off. Slash commands do not count.
- **Recall with each prompt, off by default.** Each recall block stays in context for every later
  turn and costs input tokens, and weak matches fill the context. Turn on `recall` and the plugin
  searches lumberroom with your prompt and attaches new hits for the model only. It skips prompts under 12 characters and drops hits whose similarity is below
  `recallMinSimilarity`. A hit goes out once, until `/clear` or a compaction empties the context
  that held it. The first prompt of a session can wait for the bootstrap plus the search (up to
  `bootstrapTimeoutMs` plus `recallTimeoutMs`); later prompts wait at most `recallTimeoutMs`. Three
  failures in a row pause recall for a minute.
- **One store.** Claude Code's built-in memory section leaves the system prompt. The plugin refuses
  `Read`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` on `~/.claude/MEMORY.md` and on anything
  under `~/.claude/projects/*/memory/`, and `Grep` and `Glob` whose `path` is inside that folder
  (those two tools are absent from the 2.1.287 build, so that part is untested against a real
  call). `Bash` is not guarded: `cat` or `rm` on a memory file goes through. `/lr-import` sends what
  those files already hold to the engine's proposal queue for you to review.

- **A token counter on the status line.** Under the prompt the plugin shows an estimate, at four
  characters a token, of what lumberroom adds to the context: the digest section, the reminder and
  recall blocks, and the results of the model's own lumberroom tool calls. Compaction and `/clear`
  zero the last two.

The plugin writes nothing on its own unless you turn on the extractor. The model writes when it
calls `memory_write`.

## Requirements

- Claude Code 2.1.287 or later.
- The `lumberroom` MCP server registered in Claude Code (`claude mcp list` shows it). See the
  engine's `docs/connect-claude-code.md`.

## Load it

While developing, from a terminal:

```
claude --plugin-dir /path/to/lumberroom-claude-code
```

or link the folder into a session's mods folder (`~/.claude/dev-mods/<session>/lumberroom-memory`)
and accept hot reloading when Claude Code asks.

The plugin allows its own calls to `context_bootstrap`, `memory_search` and `memory_write` through
the permission check. The model's own calls to lumberroom still follow your permission rules.

## Options

Set them in `/config`, or under `pluginConfigs["lumberroom-memory"].options` in
`~/.claude/settings.json`.

| Option | Default | Meaning |
| --- | --- | --- |
| `server` | `lumberroom` | MCP server name as `/mcp` lists it |
| `baseUrl` | `https://mcp.lumberroom.cloud` | engine URL for `/lr-import` |
| `project` | `auto` | `auto` uses the git root's folder name; `none` sends none; else the slug |
| `recall` | off | search with each prompt; costs input tokens on every later turn |
| `recallExtraProjects` | empty | other project slugs to search with each prompt, separated by commas or whitespace. A bare slug applies everywhere; `project=slug1+slug2` applies only in that project, for example `lumberroom-cloud=lumberroom` for a fork that shares its engine's decisions. Claude Code reads plugin options from user, `--settings` or managed settings only, never project settings, so a per-project value goes inside the option |
| `recallLimit` | 6 | hits asked for |
| `recallMaxChars` | 4000 | cap on the whole recall block: tags, note, hits and write reminder |
| `recallMinSimilarity` | 0.6 | drop hits below this similarity (0 to 1); hits with none pass |
| `recallTimeoutMs` | 2500 | wait for `memory_search` |
| `bootstrapTimeoutMs` | 4000 | wait for `context_bootstrap` |
| `digestMaxChars` | 8000 | cap on the digest section |
| `reviewInterval` | 8 | search and write reminder every N prompts, recall on or off; 0 is off |
| `replaceBuiltinMemory` | on | drop built-in memory and guard its files |
| `extractor` | `off` | `turn` or `session-end` to write facts automatically |
| `extractorModel` | `haiku` | model for the extractor |
| `ingestToken` | unset | bearer with `mayIngest`, for `/lr-import`; kept in secure storage |

## Commands

An option edited in `~/.claude/settings.json` by hand takes effect after `/reload-plugins`; a change through `/config` reloads the plugin itself.


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

Everything above is implemented. `claude plugin test` covers the logic and the hooks it can reach.
It cannot raise `tool.check` as this plugin, so the self-allow hook itself has no unit test beyond
the decision function. A unit test does not show that a live session behaves the same way, so this
section lists only what a live Claude Code 2.1.287 session has shown.

Measured so far:

- Recall attached on 10 of 10 headless turns.
- The `tool.check` self-allow showed in the debug log.
- The guard refused a `Write` to a memory file in an interactive session.
- The old hook's block was removed from the SessionStart context in a headless run.
- `/lr-import` with no `ingestToken` answered with the setting hint and posted nothing, in an interactive session.
- `/lr-import all` listed the one folder holding memory files and proposed `project:lr-import-test` from the path it found; `/lr-import confirm 1` posted 3 proposals (3 new) to the ingest queue with the expected namespaces (2 under the project, 1 under `user:me`), and a second `confirm 1` posted nothing. The `ingestToken` was read from `pluginConfigs` in `~/.claude/settings.json`.
- Recall in an interactive session attached one hit to a prompt about the import command, where the same session attached five unrelated hits before the relevance floor existed.

Filled in by the lead after the next live run: the relevance floor and the 12-character minimum
against real prompts, the extractor against a real model, `/lr-import all` and `confirm` against a real engine,
and `Grep` and `Glob` on a build that has them.

## Develop

```
npm install          # TypeScript, for type-checking only
npm run gate         # claude plugin validate, tsc, claude plugin test
```

Design and measurements: [docs/spec.md](docs/spec.md). Task order: [docs/plan.md](docs/plan.md).

## License

Apache-2.0.
