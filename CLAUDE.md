# nudge

MCP server plugin for Claude Code. Provides session-scoped reminders, watchers, and background process awaits.

## Stack

- TypeScript, Bun, @modelcontextprotocol/sdk
- No other runtime deps

## Structure

- `src/triggers.ts` — TriggerStore and trigger types (remind, watch, await)
- `src/index.ts` — MCP server, tool registration, notification dispatch
- `test/triggers.test.ts` — Unit tests for all trigger types

## Commands

- `bun test` — run tests
- `bun run typecheck` — typecheck
- `bun run start` — start server (stdio transport)

## Design

- Each trigger gets a human-readable ID: `remind-1`, `watch-3`, etc.
- Triggers are one-shot: they auto-remove after firing
- Watch has `max_attempts` to prevent infinite polling
- Notifications sent via `server.sendLoggingMessage` as structured JSON
- All state is in-memory, session-scoped — no persistence
