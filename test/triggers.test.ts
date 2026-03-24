import { describe, test, expect, beforeEach, mock } from "bun:test";
import { TriggerStore, parseDelay, _resetCounter } from "../src/triggers";

beforeEach(() => {
  _resetCounter();
});

describe("parseDelay", () => {
  test("parses seconds", () => expect(parseDelay("10s")).toBe(10_000));
  test("parses minutes", () => expect(parseDelay("5m")).toBe(300_000));
  test("parses hours", () => expect(parseDelay("2h")).toBe(7_200_000));
  test("rejects invalid", () => expect(() => parseDelay("abc")).toThrow());
  test("rejects no unit", () => expect(() => parseDelay("10")).toThrow());
});

describe("TriggerStore", () => {
  let store: TriggerStore;

  beforeEach(() => {
    store = new TriggerStore();
  });

  describe("remind", () => {
    test("creates with correct ID", () => {
      const onFire = mock(() => {});
      const trigger = store.createRemind(1000, "test", onFire);
      expect(trigger.id).toBe("remind-1");
      expect(trigger.type).toBe("remind");
      expect(trigger.delayMs).toBe(1000);
      trigger.cancel();
    });

    test("fires after delay", async () => {
      const onFire = mock(() => {});
      store.createRemind(50, "test prompt", onFire);
      await Bun.sleep(100);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire.mock.calls[0][1]).toContain("test prompt");
    });

    test("removes itself after firing", async () => {
      const onFire = mock(() => {});
      store.createRemind(50, "test", onFire);
      expect(store.list()).toHaveLength(1);
      await Bun.sleep(100);
      expect(store.list()).toHaveLength(0);
    });

    test("can be cancelled", async () => {
      const onFire = mock(() => {});
      const trigger = store.createRemind(50, "test", onFire);
      store.remove(trigger.id);
      await Bun.sleep(100);
      expect(onFire).not.toHaveBeenCalled();
    });
  });

  describe("await", () => {
    test("fires on command completion", async () => {
      const onFire = mock(() => {});
      const trigger = store.createAwait("echo hello", "done", onFire);
      expect(trigger.id).toBe("await-1");
      expect(trigger.type).toBe("await");
      await Bun.sleep(200);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire.mock.calls[0][1]).toContain("succeeded");
      expect(onFire.mock.calls[0][1]).toContain("hello");
    });

    test("reports failure", async () => {
      const onFire = mock(() => {});
      store.createAwait("exit 1", "done", onFire);
      await Bun.sleep(200);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire.mock.calls[0][1]).toContain("failed");
    });

    test("can be cancelled", async () => {
      const onFire = mock(() => {});
      const trigger = store.createAwait("sleep 10", "done", onFire);
      store.remove(trigger.id);
      await Bun.sleep(100);
      expect(onFire).not.toHaveBeenCalled();
    });
  });

  describe("watch", () => {
    test("fires when condition met", async () => {
      const onFire = mock(() => {});
      // echo always outputs "ready", so condition "ready" is met immediately
      const trigger = store.createWatch("echo ready", "ready", 50, 10, "site up", onFire);
      expect(trigger.id).toBe("watch-1");
      await Bun.sleep(200);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire.mock.calls[0][1]).toContain("condition met");
    });

    test("exhausts max attempts", async () => {
      const onFire = mock(() => {});
      store.createWatch("echo nope", "ready", 30, 3, "test", onFire);
      await Bun.sleep(300);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire.mock.calls[0][1]).toContain("exhausted");
    });

    test("can be cancelled", async () => {
      const onFire = mock(() => {});
      const trigger = store.createWatch("echo nope", "ready", 50, 100, "test", onFire);
      store.remove(trigger.id);
      await Bun.sleep(200);
      expect(onFire).not.toHaveBeenCalled();
    });
  });

  describe("list and cancel", () => {
    test("lists all triggers", () => {
      const noop = mock(() => {});
      store.createRemind(60000, "a", noop);
      store.createRemind(60000, "b", noop);
      expect(store.list()).toHaveLength(2);
      store.clear();
    });

    test("cancel returns false for unknown ID", () => {
      expect(store.remove("nope-1")).toBe(false);
    });

    test("clear cancels everything", () => {
      const noop = mock(() => {});
      store.createRemind(60000, "a", noop);
      store.createRemind(60000, "b", noop);
      store.clear();
      expect(store.list()).toHaveLength(0);
    });
  });
});
