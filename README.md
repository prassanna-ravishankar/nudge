# nudge

An MCP server that gives Claude Code session-scoped triggers: timers, command watchers, and background process awaits. When a trigger fires, Claude gets a channel notification with your prompt — so it can react to things that happen while you're working.

## Why

Claude Code sessions are synchronous — Claude responds to your messages but can't independently notice that a build finished, a deploy landed, or 10 minutes passed. nudge fills that gap by running triggers in the background and pushing notifications back into the conversation when they fire.

## Installation

Requires [Bun](https://bun.sh).

```bash
git clone <repo-url> && cd nudge
bun install
```

Add to your Claude Code MCP config (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "nudge": {
      "command": "bun",
      "args": ["run", "/path/to/nudge/src/index.ts"]
    }
  }
}
```

Restart Claude Code. nudge registers its tools automatically.

## Tools

### `remind`

One-shot timer. Fires after a delay.

| Param | Type | Description |
|-------|------|-------------|
| `delay` | string | Duration: `"30s"`, `"5m"`, `"2h"` |
| `prompt` | string | Message delivered when timer fires |

```
remind(delay: "10m", prompt: "check if PR review is done")
```

### `watch`

Polls a shell command at an interval. Fires when the output contains a target string.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `cmd` | string | — | Shell command to run each poll |
| `until` | string | — | String to match in output |
| `interval` | string | `"30s"` | Poll interval |
| `max_attempts` | number | `100` | Max polls before giving up |
| `prompt` | string | — | Message delivered when condition met |

```
watch(cmd: "curl -s https://api.example.com/health", until: "ok", interval: "1m", prompt: "API is back up")
watch(cmd: "gh pr view 42 --json state -q .state", until: "MERGED", prompt: "PR #42 merged")
```

### `await`

Runs a command in the background. Fires when the process exits (success or failure).

| Param | Type | Description |
|-------|------|-------------|
| `cmd` | string | Shell command to run |
| `prompt` | string | Message delivered on exit |

```
await(cmd: "npm run build", prompt: "build finished")
await(cmd: "docker compose up --build 2>&1", prompt: "containers ready")
```

### `list_triggers`

Shows all active triggers with their IDs, prompts, and age.

```
list_triggers()
→ remind-1: check PR review (created 342s ago)
→ watch-2: API health check (created 120s ago)
```

### `cancel_trigger`

Cancels an active trigger by ID.

| Param | Type | Description |
|-------|------|-------------|
| `trigger_id` | string | ID returned when trigger was created |

```
cancel_trigger(trigger_id: "remind-1")
```

## How it works

nudge is an MCP server that communicates over stdio. On startup, it registers 5 tools and provides instructions telling Claude what channel events look like.

When a trigger fires, nudge sends a `notifications/message` log event with a structured JSON payload:

```json
{
  "channel": "nudge",
  "trigger_id": "remind-1",
  "type": "remind",
  "prompt": "check if PR review is done",
  "message": "Timer fired after 600000ms: check if PR review is done"
}
```

Claude sees this as a channel event and acts on the prompt.

All state is in-memory. Triggers live only as long as the Claude Code session — no persistence, no cleanup needed.

## Architecture

```
src/
  index.ts       MCP server, tool registration, notification dispatch
  triggers.ts    TriggerStore — creates/manages remind, watch, await triggers
test/
  triggers.test.ts   Unit tests (18) — trigger logic, parsing, cancellation
  e2e.test.ts        E2E tests (9) — real MCP client against live server
```

Two files. `TriggerStore` owns all trigger lifecycle (create, fire, cancel). The MCP server layer is thin — it maps tool calls to store methods and wires up `sendLoggingMessage` as the fire callback.

Each trigger gets a human-readable ID (`remind-1`, `watch-3`). Triggers are one-shot: they auto-remove from the store after firing. Watch has `max_attempts` to prevent infinite polling.

## Development

```bash
bun test              # all tests (unit + e2e)
bun run test:unit     # unit tests only
bun run test:e2e      # e2e tests only
bun run typecheck     # type check
bun run start         # start server on stdio
```
