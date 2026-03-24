import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { TriggerStore, parseDelay, type Trigger } from "./triggers.js";

const store = new TriggerStore();

const INSTRUCTIONS = `You have access to nudge, a session-scoped trigger system. When a trigger fires, you'll receive a channel event like:
<channel source="nudge" trigger_id="remind-1" type="remind">check PR status</channel>

Trigger types:
- remind: fires once after a delay (e.g. "10m", "2h")
- watch: polls a command at an interval until output contains a string, then fires
- await: runs a background command, fires when it exits

Use list_triggers to see active triggers, cancel_trigger to stop one.`;

const server = new McpServer(
  { name: "nudge", version: "0.1.0" },
  {
    capabilities: {
      logging: {},
    },
    instructions: INSTRUCTIONS,
  },
);

function fireTrigger(trigger: Trigger, message: string): void {
  server.server
    .sendLoggingMessage({
      level: "info",
      data: JSON.stringify({
        channel: "nudge",
        trigger_id: trigger.id,
        type: trigger.type,
        prompt: trigger.prompt,
        message,
      }),
    })
    .catch((err) => console.error("Failed to send notification:", err));
}

// --- Tools ---

server.tool(
  "remind",
  "Set a one-shot timer that fires after a delay",
  { delay: z.string().describe('Delay before firing, e.g. "10s", "5m", "2h"'), prompt: z.string().describe("Message to deliver when timer fires") },
  async ({ delay, prompt }) => {
    const delayMs = parseDelay(delay);
    const trigger = store.createRemind(delayMs, prompt, fireTrigger);
    return { content: [{ type: "text", text: `Created ${trigger.id}: will fire in ${delay}` }] };
  },
);

server.tool(
  "watch",
  "Poll a shell command at an interval until output contains a string",
  {
    cmd: z.string().describe("Shell command to run each poll"),
    until: z.string().describe("String to look for in command output"),
    interval: z.string().default("30s").describe('Poll interval, e.g. "30s", "1m"'),
    max_attempts: z.number().default(100).describe("Max poll attempts before giving up"),
    prompt: z.string().describe("Message to deliver when condition is met"),
  },
  async ({ cmd, until, interval, max_attempts, prompt }) => {
    const intervalMs = parseDelay(interval);
    const trigger = store.createWatch(cmd, until, intervalMs, max_attempts, prompt, fireTrigger);
    return { content: [{ type: "text", text: `Created ${trigger.id}: polling every ${interval} for "${until}"` }] };
  },
);

server.tool(
  "await",
  "Run a background command and fire when it exits",
  { cmd: z.string().describe("Shell command to run in the background"), prompt: z.string().describe("Message to deliver when command exits") },
  async ({ cmd, prompt }) => {
    const trigger = store.createAwait(cmd, prompt, fireTrigger);
    return { content: [{ type: "text", text: `Created ${trigger.id}: running \`${cmd}\`` }] };
  },
);

server.tool("list_triggers", "List all active triggers", {}, async () => {
  const triggers = store.list();
  if (triggers.length === 0) {
    return { content: [{ type: "text", text: "No active triggers" }] };
  }
  const lines = triggers.map((t) => {
    const age = Math.round((Date.now() - t.createdAt) / 1000);
    return `${t.id}: ${t.prompt} (created ${age}s ago)`;
  });
  return { content: [{ type: "text", text: lines.join("\n") }] };
});

server.tool("cancel_trigger", "Cancel an active trigger", { trigger_id: z.string().describe("ID of the trigger to cancel") }, async ({ trigger_id }) => {
  const removed = store.remove(trigger_id);
  return {
    content: [{ type: "text", text: removed ? `Cancelled ${trigger_id}` : `No trigger found with ID ${trigger_id}` }],
  };
});

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("nudge MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

export { server, store };
