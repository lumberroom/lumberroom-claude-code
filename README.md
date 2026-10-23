# lumberroom for Claude Code

![lumberroom](assets/icon.png)

lumberroom as Claude Code's memory, built as a Claude Code mod (a plugin of function hooks). The
digest sits in the system prompt, a short reminder tells the model to search and to write, and
Claude Code's own file memory is switched off. Recall with each prompt is available and off by
default. It targets lumberroom.cloud or a self-hosted engine through an MCP server the plugin
brings with it. The live sessions listed below ran against the hosted engine.

[![One memory for all your AI agents: Lumberroom in Claude Code](https://i.ytimg.com/vi/pwxtlSd0JZY/maxresdefault.jpg)](https://youtu.be/pwxtlSd0JZY)

More videos: [Lumberroom playlist](https://www.youtube.com/playlist?list=PLICXFDm9bubU)

Built for Claude Code. The digest, the reminder, the status line and the memory guard are Claude
Code hooks, so on claude.ai, the desktop app or Cowork only the bundled MCP server applies.

**Status:** The Claude Code mod API is early access (built and observed on 2.1.287) and may
change between releases.

## What it does

- **The digest in the system prompt.** At session start the plugin calls `context_bootstrap` for the
  project and adds the digest and the write rule as one section of the system prompt. It does not
  edit `CLAUDE.md` or your settings. If you still run the old `lumberroom bootstrap --hook` shell
  hook, remove it from the `SessionStart` hooks in `~/.claude/settings.json`, or the session gets
  the digest twice. When `~/.claude/CLAUDE.md` or the project's `CLAUDE.md` already carries the write rule,
  the plugin leaves its own copy of the rule out of the section. The check reads
  `~/.claude/CLAUDE.md` and `<git root>/CLAUDE.md` (the working directory when there is no git root)
  for a `# Durable memory` heading followed by `memory_write`.
- **The digest follows the first request.** The conversation's first prompt of 12 characters or
  more goes to `context_bootstrap` as `query`, once, recall on or off. An engine with that argument
  answers with the facts related to the request and a profile ordered by relevance, and the section
  redraws. The system prompt then changes once, after that prompt. A timeout, an error or an engine
  without `query` keeps the session-start digest. `digestQuery: false` turns it off.
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
- **The rules as a skill, for Cowork.** `skills/lumberroom-memory` carries the same
  read and write rules. In Claude Code the digest section already holds them; in Cowork, where only
  the MCP server and the skill load, the skill is what tells the model to bootstrap, search and
  write. The MCP server's own tool descriptions say what each tool does and give no orders.
- **`/lr-review` works the review queue.** `skills/lr-review` settles dreaming proposals,
  conflicts and duplicates from the memories alone and asks you only about contradictions no date
  can order, in one list at the end.

The plugin writes nothing on its own unless you turn on the extractor. When on, the extractor calls
`memory_write` directly. Otherwise the model writes when it calls `memory_write`.

## Hooks

Every hook lives in `hooks/register.ts`. None answers a permission check, changes a permission
mode, or rewrites a settings, agent, command or file-write event. The plugin runs no shell command,
spawns no process or agent, and calls no shell tool. The one file it writes is your user
`settings.json`, through `/lr-setup`, after you confirm.

| Hook | What it does |
| --- | --- |
| `session.start` | Calls `context_bootstrap` on the lumberroom server, caches the digest, registers `/lr-import` and `/lr-setup` and draws the status line |
| `prompt.compose` | Adds the digest and the write rule to the system prompt as one section |
| `prompt.section` (`memory`) | Removes Claude Code's built-in memory section when `replaceBuiltinMemory` is on |
| `prompt.submit` | Adds the reminder every `reviewInterval` prompts; on the conversation's first eligible prompt, refetches the digest with that prompt as `query`; with `recall` on, calls `memory_search` and attaches the hits. Under an organization's guard, also attaches the digest once a conversation ([Organization-managed Claude Code](#organization-managed-claude-code)) |
| `tool.call` | See below |
| `turn.complete`, `session.end`, `session.compact` | Run the extractor when it is on: a model call through Claude Code, then `memory_search` and `memory_write`. `turn.complete` also notes a finished turn that `prompt.compose` never saw |
| `command.run` (`lr-import`, `lr-setup`) | Answers `/lr-import` and `/lr-setup`, the plugin's own commands; no other command reaches this hook |

**What `tool.call` does with the calls it sees.** It reads the tool name and the path argument. With
`replaceBuiltinMemory` on, it refuses `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Grep`
and `Glob` when the path lands in `~/.claude/MEMORY.md` or `~/.claude/projects/*/memory/`, and
answers with the reason. That refusal is the plugin's own rule, applied before your permission
rules, and turning the option off removes it. For a call to a lumberroom tool it measures the length
of the result for the token counter. It passes every other call on unchanged, and it never
approves a call, never rewrites one and never sends what it sees anywhere.

## What it calls and fetches

**Tools the plugin calls itself, without the model asking.** All three are lumberroom tools on the
MCP server Claude Code connects (`$.mcp.call`), and Claude Code runs each one through your
permission rules:

| Tool | When |
| --- | --- |
| `context_bootstrap` | At session start, retried for up to `bootstrapTimeoutMs` while the server connects; on later prompts until one answers, if session start got none; once more on the conversation's first prompt of 12 characters or more, with that prompt as `query`, within `recallTimeoutMs`, unless `digestQuery` is off |
| `memory_search` | With each prompt from you when `recall` is on; with the extractor on, once before each extracted fact is written, to find the row it may replace |
| `memory_write` | With the extractor on, once for each fact it extracted. Off by default |

The tool names are fixed text in the code. The plugin calls no other tool. It also makes model calls
through Claude Code (`$.model.complete`, on `extractorModel`) for the extractor, for the judge that
decides whether a new fact replaces an old one, and for the namespace guess in `/lr-import all`.

**Network requests.** The plugin contacts two endpoints:

- **The MCP server**, at `https://mcp.lumberroom.cloud/mcp`, or the `lumberroom` server you
  registered for a self-hosted engine. Claude Code makes these connections; the plugin only asks
  for the tool calls above.
- **The engine the lumberroom CLI points at**, only when you run `/lr-import` or
  `/lr-import confirm`: `LUMBERROOM_URL`, else the `url` in the CLI's config file, else
  `https://mcp.lumberroom.cloud`. The plugin makes these requests itself with `$.http.fetch`, three
  kinds of `POST` carrying the credential described under [Commands](#commands) as a bearer:
  `/admin/ingest/runs` opens an ingest run, `/admin/ingest/proposals` sends the memory files as
  proposals in batches, and `/admin/ingest/runs/<id>/close` closes the run. It refuses an engine URL
  that is not https, except for `localhost` and `127.0.0.1`.

The plugin fetches no code and no instructions: the engine's answers are the digest, search hits
and ingest counts, and the plugin shows them to the model as data.

## What it reads, what it sends, and where

Everything goes to the lumberroom engine, lumberroom.cloud by default or your own. Nothing goes to
any other server.

**From the conversation:**

- **Your prompt text**, clipped, with the project slug, in a `memory_search` call. Only when
  `recall` is on.
- **The conversation's first eligible prompt**, up to 1,000 characters, with the project slug, in
  one `context_bootstrap` call, recall on or off. Once a conversation; `digestQuery: false` stops
  it.
- **The conversation's messages**, when the extractor is on. A model call through Claude Code reads
  the turns since the last extraction and pulls out facts; that call runs on your Claude account,
  with no third party involved. The facts, not the transcript, go to the engine with `memory_write`,
  each preceded by a `memory_search` on the fact's text.
- **At session start**, the project slug (the git root's folder name) in `context_bootstrap`. No
  conversation text goes with it until the first eligible prompt, above.

**From your machine:**

- `~/.claude/CLAUDE.md` and the project's `CLAUDE.md`, to see whether they already carry the write
  rule. Their text stays on your machine.
- Claude Code's memory files under `~/.claude/projects/*/memory/`, read and posted to the engine's
  proposal queue only when you run `/lr-import` or `/lr-import confirm`. `/lr-import all` lists the
  folders and posts nothing.
- The lumberroom CLI's config file (`LUMBERROOM_CONFIG`, else `~/.config/lumberroom/config.json`),
  read for its engine URL and bearer only when `/lr-import` or `/lr-import confirm` posts. The
  plugin never writes to it.
- Your merged settings' `permissions.allow` and `permissions.deny`, read by `/lr-setup` to see which
  rules are missing. When you confirm, it adds the missing rules to `permissions.allow` in
  `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) and keeps every other key.
- For the memory guard, the path a file tool names and where its links resolve. The paths stay on
  your machine.

**The model's own calls:** when Claude calls `memory_search`, `memory_write` or another lumberroom
tool, those calls go to the same engine under your permission rules.

The plugin keeps a digest cache, a duplicate guard for writes and the `/lr-import` plan in Claude
Code's plugin storage. The only file it writes is your user `settings.json`, when you confirm `/lr-setup`. The hosted service's privacy policy is
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

The plugin brings its own MCP server, connecting to `https://mcp.lumberroom.cloud/mcp`. It asks for no
settings on install. Run `/mcp` once and sign in to `plugin:lumberroom-memory:lumberroom`. Its tools appear as
`mcp__plugin_lumberroom-memory_lumberroom__memory_search` and so on, so a permission rule or agent
definition that names `mcp__lumberroom__*` needs the new names.

### Self-hosted engine

Register your engine as an MCP server named `lumberroom`, then restart Claude Code:

```
claude mcp add --scope user --transport http lumberroom https://lr.example.com/mcp
```

Add `--header "Authorization: Bearer <token>"` if your engine accepts only static bearer tokens.
The plugin tries the bundled server first and falls back to `lumberroom`, so it needs no option.
The bundled server still points at lumberroom.cloud and shows as needing sign-in; disable
`plugin:lumberroom-memory:lumberroom` in `/mcp` to hide it. For `/lr-import`, point the lumberroom
CLI at the same engine (`LUMBERROOM_URL=https://lr.example.com lumberroom login`).

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
through your permission rules, so allow those three tools once: run `/lr-setup`, confirm, and the
digest loads in the same session. [docs/permissions.md](docs/permissions.md) has the rules if you
would rather add them by hand. Until you do, the session starts without the digest and the plugin
shows a toast that points at `/lr-setup`.

## Organization-managed Claude Code

On a machine with managed settings, or under a Team or Enterprise `/login`, Claude Code seats a
built-in guard, [`sec-default@builtin`](https://github.com/anthropics/claude-code/blob/main/mods/sec-default/README.md)
(`cc-plugin-sec-default` in `/plugin` and the debug log). Your users can't turn it off. A plugin
installed from a GitHub marketplace runs in the user tier, and the guard sends some events past that
tier, so three of this plugin's hooks never run:

| Hook the guard skips | What you lose |
| --- | --- |
| `prompt.compose` | The digest section in the system prompt |
| `prompt.section` (`memory`) | Removing Claude Code's built-in memory section. The `tool.call` guard on the memory files still works |
| `session.compact` | The extraction before compaction and the keep-facts line in the compaction instructions |

`session.start`, `prompt.submit`, `tool.call`, `turn.complete`, `session.end` and the commands still
run.

**Best route: have your admin seat the plugin as the organization's.** The guard leaves alone a
plugin your organization seats in its own tier, so every hook runs. Claude Code counts a plugin as
the organization's only when it loads in place from a local directory marketplace. A copy from
GitHub, git, a URL or npm counts as a user's, even when managed `enabledPlugins` turns it on. Your admin:

1. Copies this repository, [lumberroom-claude-code](https://github.com/lumberroom/lumberroom-claude-code),
   to the same path on every machine, in a directory only an administrator can write, for example
   `/opt/acme/claude-plugins/plugins/lumberroom-memory`.
2. Writes `/opt/acme/claude-plugins/.claude-plugin/marketplace.json`, named `lumberroom`, that lists
   the plugin by a relative path:

   ```json
   {
     "name": "lumberroom",
     "owner": { "name": "Acme" },
     "plugins": [{ "name": "lumberroom-memory", "source": "./plugins/lumberroom-memory" }]
   }
   ```

3. Adds this to managed settings:

   ```json
   {
     "extraKnownMarketplaces": {
       "lumberroom": { "source": { "source": "directory", "path": "/opt/acme/claude-plugins" } }
     },
     "enabledPlugins": { "lumberroom-memory@lumberroom": true },
     "appendPlugins": ["lumberroom-memory@lumberroom"]
   }
   ```

The managed marketplace named `lumberroom` replaces a user's own `lumberroom` marketplace entry,
the GitHub one `/plugin marketplace add` registers, so each machine loads one copy. The repository
root holds both the plugin and its own `.claude-plugin/marketplace.json`; nobody has yet tested
that copy nested under another marketplace.

`appendPlugins` runs the plugin behind your users' mods, inside the guard. If you list it in
`prependPlugins` instead, name `sec-default@builtin` in that list too, because the list replaces the
whole prepend tier. To check, run `claude --debug`: the line `hooks module
lumberroom-memory@lumberroom loaded` should say `tier append`. The admin steps come from
[Manage mods for your organization](https://code.claude.com/docs/en/plugins/mods/admin.md).

If managed settings turn on the guard's `allowManagedModsOnly` option, the guard refuses a user-tier
copy outright: nothing runs, and the debug log names `allowManagedModsOnly`. The admin route is
then the only one.

**Without an admin: the plugin falls back to prompt context.** When a turn finishes and the
plugin's `prompt.compose` hook never ran, the plugin decides the guard holds it. It logs one line
in the transcript and stores that in its plugin storage. From then on it attaches the digest and the
write rule to your prompt once a conversation, as prompt context:

- **The first session on a machine gets the digest from its second prompt.** An interactive session
  composes the system prompt after the first prompt goes out, so that prompt can't tell yet. Later
  sessions on the same machine attach it to the first prompt.
- **The copy waits for the query.** On the first eligible prompt the plugin waits up to
  `recallTimeoutMs` for the digest fetched with that prompt as `query`, so the one copy carries the
  facts related to the request.
- **The copy stays in the transcript.** It costs its tokens on every later turn, as the section
  does, but a refetched digest does not replace it. The status line counts it under `digest`.
- **`/clear` and compaction send it again.** The guard hides compaction from the plugin too, so the
  plugin counts the conversation's messages at each prompt and at the end of each turn, and reads a
  drop as a compaction. The next prompt then carries a fresh copy and recall's duplicate check
  resets. A compaction in the middle of a turn that leaves more messages than the last count goes
  unnoticed.
- **The guard going away undoes it.** As soon as `prompt.compose` runs again, the plugin clears the
  stored flag and the system prompt carries the digest. The digest can show up twice on that one turn.
- **A plugin loaded in the middle of a session can trip it once.** Claude Code may have built the
  system prompt before the plugin loaded, so `prompt.compose` doesn't fire and the plugin takes the
  turn for the guard. The next session clears the flag on its first `prompt.compose`.

What the fallback can't bring back: Claude Code's built-in memory section stays in the system
prompt, and nothing runs at compaction. Set `extractor` to `turn` or `session-end`, both of which
still run under the guard, if you want automatic extraction.

## Options

Set them in `/config`, or under `pluginConfigs["lumberroom-memory"].options` in
`~/.claude/settings.json`.

| Option | Default | Range | Meaning |
| --- | --- | --- | --- |
| `project` | `auto` |  | `auto` uses the git root's folder name; `none` sends none; else the slug |
| `recall` | off |  | search with each prompt; costs input tokens on every later turn |
| `digestQuery` | on |  | send the conversation's first prompt of 12 characters or more to `context_bootstrap` as `query`, so the digest adds the facts related to it; the system prompt changes once, after that prompt |
| `recallExtraProjects` | empty |  | other project slugs to search with each prompt, separated by commas or whitespace. A bare slug applies everywhere; `project=slug1+slug2` applies only in that project, for example `lumberroom-cloud=lumberroom` for a fork that shares its engine's decisions. Claude Code reads plugin options from user, `--settings` or managed settings only, never project settings, so a per-project value goes inside the option |
| `recallLimit` | 6 | 1 to 20 | hits asked for |
| `recallMaxChars` | 4000 | 500 to 16000 | cap on the whole recall block: tags, note, hits and write reminder |
| `recallMinSimilarity` | 0.6 | 0 to 1 | drop hits below this similarity; hits with no similarity pass |
| `recallTimeoutMs` | 2500 | 500 to 8000 | wait for `memory_search` |
| `bootstrapTimeoutMs` | 5000 | 5000 to 8000 | wait for `context_bootstrap` |
| `digestMaxChars` | 8000 | 1000 to 30000 | cap on the digest section |
| `reviewInterval` | 8 | 0 to 100 | search and write reminder every N prompts, recall on or off; 0 is off |
| `replaceBuiltinMemory` | on |  | drop built-in memory and guard its files |
| `extractor` | `off` | `off`, `turn`, `session-end` | `turn` or `session-end` to write facts automatically |
| `extractorModel` | `haiku` |  | model for the extractor |
| `ingestToken` | unset |  | optional bearer with `mayIngest` for `/lr-import`, ahead of the CLI's credential; kept in secure storage, so `/config` does not list it (see [Commands](#commands)) |

Numeric options are rounded to whole numbers and clamped to the range; a non-numeric value falls back to the default. `recallMinSimilarity` is clamped but not rounded.

## Commands

An option edited in `~/.claude/settings.json` by hand takes effect after `/reload-plugins`; a change
through `/config` reloads the plugin itself.

- `/lr-setup`: allow the plugin's own `context_bootstrap`, `memory_search` and `memory_write` calls.
  It names the rules for the server lumberroom runs under, asks before it changes anything, adds
  the missing ones to `permissions.allow` in your user `settings.json`, then fetches the digest.
  It leaves a file it cannot parse alone, and stops at a deny rule, which an allow rule cannot
  override. `/lr-setup show` prints the rules and changes nothing.
- `/lr-import`: send this project's memory files to the proposal queue. Each call waits 15 s, the closing
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

`/lr-import` and `/lr-import confirm` take their credential from the first of these that is set:

1. The `ingestToken` option.
2. `LUMBERROOM_TOKEN` in Claude Code's environment.
3. The `token` in the lumberroom CLI's config file.
4. The CLI's OAuth login (`oauth.access_token` in the same file).

So once you have run `lumberroom login` and picked the **Full** profile on the consent screen, the
only profile that carries the `mayIngest` grant, `/lr-import` works with nothing set in the plugin.
A Standard login answers HTTP 403; run `lumberroom login --reregister` and pick Full. When the CLI's
access token has expired, `/lr-import` asks you to run `lumberroom whoami`, which refreshes it.

`ingestToken` is a sensitive option, so Claude Code keeps it in secure storage and `/config` does not
list it. Set or change it from a terminal:

```
echo '{"ingestToken":"<token>"}' | claude plugin configure lumberroom-memory@lumberroom --values-stdin
```

Send `{"ingestToken":""}` the same way to clear it and fall back to the CLI.

## Implemented versus verified

Everything above is implemented. `npm run gate` runs 558 tests, a unit-level result (4 failed on Claude Code 2.1.309 on 23 October 2026, all from before the guard fallback): it covers
the logic and the hooks `claude plugin test` can reach. A unit test does not show that a live session
behaves the same way, so this section lists what a live Claude Code 2.1.287 session has shown.

Observed in a live 2.1.287 session:

- Recall attached on 10 of 10 headless turns.
- The guard refused a `Write` to a memory file in an interactive session.
- `/lr-import` with no `ingestToken` answered with the setting hint and posted nothing, in an interactive session.
- `/lr-import all` listed the one folder holding memory files and proposed `project:lr-import-test` from the path it found; `/lr-import confirm 1` posted 3 proposals (3 new) to the ingest queue with the expected namespaces (2 under the project, 1 under `user:me`), and a second `confirm 1` posted nothing. The `ingestToken` was read from `pluginConfigs` in `~/.claude/settings.json`.
- Recall in an interactive session attached one hit to a prompt about the import command, where the same session attached five unrelated hits before the relevance floor existed.
- Compaction, on 2 October 2026: after a manual `/compact` in an interactive session, the digest section (the `# Durable memory (lumberroom)` heading, the project line and the engine digest) was still in the system prompt. The plugin's keep-facts line appeared in the compaction instructions. The reminder arrived on the 8th person prompt after compaction, so the prompt counter reset. The extractor was off, so no extraction ran.
- The write rule was left out of the section because `~/.claude/CLAUDE.md` already carries a `# Durable memory` block. Claude Code's own memory section was absent.
- Recall depends on query wording. `Cloudflare D1 port` surfaced the right memory at similarity 0.77; a bare `D1 decision` did not. Put the subject in the prompt.

Observed under a seated `sec-default@builtin`, in interactive Claude Code 2.1.309 sessions on
23 October 2026 (managed settings in `/Library/Application Support/ClaudeCode/managed-settings.json`,
the plugin in the user tier):

- The first session's first prompt carried no copy. The notice appeared once that turn ended, the
  second prompt carried the digest drawn with the first prompt as `query`, and the third carried none.
- A new session's first prompt carried the copy, from the flag the earlier session stored.
- After `/clear`, the next prompt carried the copy, the one after it none, and the notice did not
  appear again. Claude Code starts that conversation with fresh `$.state` and no `session.start`, so
  the plugin reads the stored flag on each prompt until it holds one.
- After `/compact`, the next prompt carried the copy and the one after it none. The plugin counts
  the messages of the next request (`$.session.messages({ as: 'api' })`), because the plain
  transcript keeps the rows a compaction replaced.
- With the managed-settings file removed, the next session's system prompt held the section, its
  first prompt carried the one documented double copy, the second none, and the flag was gone.

## Roadmap

UI work is tracked in [issue #1](https://github.com/lumberroom/lumberroom-claude-code/issues/1): a
recall-and-why pane, a cost and latency band, and `/lr-asof`. The token status line is the first
piece. Toasts are dropped from the plan.

## Develop

```
npm install          # TypeScript, for type-checking only
npm run gate         # validates both manifests, tsc, claude plugin test (558 tests on 23 October 2026)
```

## License

Apache-2.0.
