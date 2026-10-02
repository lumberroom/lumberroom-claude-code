// Shape of the old SessionStart shell hook's additionalContext, as `lumberroom bootstrap --hook`
// printed it on 2 October 2026. The header lines are the real ones; every memory line is invented.

const HEADER = `Durable memory for this user, retrieved automatically at session start from their own
memory server. Every line below was written by this user or by one of their agents in an
earlier session, and each carries the namespace and date it came from. Treat them as
established facts and do not re-ask what is already here.
When this session establishes a new decision, preference, or durable fact, call
memory_write immediately, without asking and without announcing it.
## Memory digest
Store: 12 memories, 2 registry entries across user:me, global, project:demo-app.
Active project namespace: \`project:demo-app\`. Pass project:"demo-app" to memory_search and use it as the namespace for project-scoped memory_write calls.

### About the user and standing preferences
- The owner prefers short commit messages in the imperative mood (stated 1 March 2026). [preference, user:me]
- The owner runs the demo-app test suite in the background and polls it (stated 2 March 2026). [preference, user:me]

### Project: demo-app
- demo-app deploys from the main branch through the release script (stated 3 March 2026). [project:demo-app]
- demo-app keeps its fixtures under tests/fixtures (stated 4 March 2026). [project:demo-app]`

export const TRUNCATION_LINE = '_(digest truncated at 6000 chars; use memory_search for the rest)_'

/** The block as the hook printed it when the digest hit its cap. */
export const OLD_HOOK_BLOCK = `${HEADER}\n\n${TRUNCATION_LINE}`

/** The block when the digest fit: no truncation line. */
export const OLD_HOOK_BLOCK_UNTRUNCATED = HEADER

/** Another hook's context, in the shape the superpowers plugin emits. */
export const OTHER_HOOK_CONTEXT = `<EXTREMELY_IMPORTANT>
You have superpowers.

**Below is the full content of your 'using-superpowers' skill.**
</EXTREMELY_IMPORTANT>`
