# Allow the plugin's lumberroom calls

The plugin makes three calls of its own: `context_bootstrap` at session start for the digest,
`memory_search` for recall and for the extractor's duplicate check, and `memory_write` when the
extractor is on. Claude Code runs each one through your permission rules, and the plugin never
answers that check for you. Without a rule that allows them, the calls are refused and the session
starts with no digest. In auto mode the classifier refuses them outright, because no prompt of
yours asked for a call made at session start.

When that happens the plugin shows one toast a session pointing at `/lr-setup`.

## Run /lr-setup

`/lr-setup` works out which name lumberroom runs under, shows the rules it is missing, and asks
before it changes anything. On **Add them** it appends them to `permissions.allow` in
`~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), keeps every other key, and
fetches the digest in the same session. It leaves a file that is not plain JSON alone and prints
the rules instead. `/lr-setup show` prints them without asking.

## Add the rules by hand

Add the tool names to `permissions.allow` in `~/.claude/settings.json`, or run `/permissions` and
add them under Allow:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_lumberroom-memory_lumberroom__context_bootstrap",
      "mcp__plugin_lumberroom-memory_lumberroom__memory_search",
      "mcp__plugin_lumberroom-memory_lumberroom__memory_write"
    ]
  }
}
```

Leave out `memory_write` if you keep the extractor off; the model's own writes then still ask you,
or follow your mode.

The rules apply to Claude's own calls to these tools too, not only the plugin's. `memory_search`
and `context_bootstrap` only read, so allowing them lets Claude read your memory without asking.
`memory_write` lets it write without asking, which is how lumberroom is meant to run.

## If lumberroom runs under another name

The names above are for the server the plugin bundles. Claude Code hides the bundled server when
another one points at the same URL, and the plugin then calls that one, under its own names:

| Where lumberroom comes from | Prefix of the tool names |
| --- | --- |
| The server bundled with the plugin | `mcp__plugin_lumberroom-memory_lumberroom__` |
| A server you registered as `lumberroom` (`claude mcp add`) | `mcp__lumberroom__` |
| A claude.ai connector named Lumberroom | `mcp__claude_ai_Lumberroom__` |

Add the three tool names with the prefix that matches your setup, or with each prefix if you are
not sure which copy is live. `/mcp` lists the servers that are connected.

## Check it

Start a new session. The status line under the prompt reads `lumberroom ~1.5k tokens in context:
digest 1.5k, ...` once the digest has loaded, and no permissions toast appears. `claude --debug`
logs `context_bootstrap answered` for the plugin when the call went through.
