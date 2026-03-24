import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { unlinkSync, writeFileSync } from "fs";

const PROJECT_ROOT = import.meta.dir.replace("/test", "");
const TESTFILE = "/tmp/nudge-e2e-testfile";

function textOf(result: any): string {
  return result.content[0].text;
}

describe("nudge e2e", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let notifications: any[];

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "bun",
      args: ["run", `${PROJECT_ROOT}/src/index.ts`],
      stderr: "pipe",
    });

    client = new Client({ name: "e2e-test", version: "1.0.0" });

    notifications = [];
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      const data = JSON.parse(notification.params.data as string);
      notifications.push(data);
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    try { unlinkSync(TESTFILE); } catch {}
    await client.close();
  });

  beforeEach(() => {
    notifications = [];
  });

  test("server connects and lists tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["await", "cancel_trigger", "list_triggers", "remind", "watch"]);
  });

  test("server exposes instructions", () => {
    const instructions = client.getInstructions();
    expect(instructions).toContain("nudge");
    expect(instructions).toContain("channel");
  });

  test("remind fires after delay", async () => {
    const result = await client.callTool({ name: "remind", arguments: { delay: "1s", prompt: "check PR" } });
    expect(textOf(result)).toContain("remind-");
    expect(textOf(result)).toContain("will fire in 1s");

    // Wait for the timer to fire
    await Bun.sleep(1500);

    expect(notifications.length).toBe(1);
    expect(notifications[0].channel).toBe("nudge");
    expect(notifications[0].type).toBe("remind");
    expect(notifications[0].prompt).toBe("check PR");
  });

  test("await fires on command exit", async () => {
    const result = await client.callTool({ name: "await", arguments: { cmd: "sleep 1 && echo done", prompt: "build finished" } });
    expect(textOf(result)).toContain("await-");

    // Wait for command to complete
    await Bun.sleep(2000);

    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe("await");
    expect(notifications[0].prompt).toBe("build finished");
    expect(notifications[0].message).toContain("succeeded");
    expect(notifications[0].message).toContain("done");
  });

  test("await reports failure on nonzero exit", async () => {
    await client.callTool({ name: "await", arguments: { cmd: "exit 42", prompt: "should fail" } });

    await Bun.sleep(500);

    expect(notifications.length).toBe(1);
    expect(notifications[0].message).toContain("failed");
    expect(notifications[0].message).toContain("exit 42");
  });

  test("watch fires when condition met", async () => {
    // Clean slate
    try { unlinkSync(TESTFILE); } catch {}

    // Start watching before file exists — will fail initially
    const result = await client.callTool({
      name: "watch",
      arguments: { cmd: `cat ${TESTFILE} 2>/dev/null || echo ''`, until: "ready", interval: "1s", max_attempts: 10, prompt: "file has ready" },
    });
    expect(textOf(result)).toContain("watch-");

    // After a short delay, create the file with the target content
    await Bun.sleep(1500);
    writeFileSync(TESTFILE, "ready\n");

    // Wait for next poll to pick it up
    await Bun.sleep(2000);

    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe("watch");
    expect(notifications[0].message).toContain("condition met");
  });

  test("list_triggers shows active triggers", async () => {
    // Create a long-lived remind so it stays active
    await client.callTool({ name: "remind", arguments: { delay: "1h", prompt: "long timer" } });

    const list = await client.callTool({ name: "list_triggers", arguments: {} });
    const text = textOf(list);
    expect(text).toContain("remind-");
    expect(text).toContain("long timer");

    // Clean up
    const id = text.split(":")[0];
    await client.callTool({ name: "cancel_trigger", arguments: { trigger_id: id } });
  });

  test("cancel_trigger stops a pending remind", async () => {
    const result = await client.callTool({ name: "remind", arguments: { delay: "2s", prompt: "should not fire" } });
    const id = textOf(result).match(/(remind-\d+)/)?.[1];
    expect(id).toBeTruthy();

    const cancelResult = await client.callTool({ name: "cancel_trigger", arguments: { trigger_id: id! } });
    expect(textOf(cancelResult)).toContain("Cancelled");

    // Verify it's gone from list
    const list = await client.callTool({ name: "list_triggers", arguments: {} });
    expect(textOf(list)).toBe("No active triggers");

    // Wait past when it would have fired
    await Bun.sleep(2500);
    expect(notifications.length).toBe(0);
  });

  test("cancel_trigger returns error for unknown ID", async () => {
    const result = await client.callTool({ name: "cancel_trigger", arguments: { trigger_id: "nope-99" } });
    expect(textOf(result)).toContain("No trigger found");
  });
});
