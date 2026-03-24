import { spawn, type Subprocess } from "bun";

export type TriggerType = "remind" | "watch" | "await";

export interface Trigger {
  id: string;
  type: TriggerType;
  prompt: string;
  createdAt: number;
  cancel(): void;
}

export interface RemindTrigger extends Trigger {
  type: "remind";
  delayMs: number;
}

export interface WatchTrigger extends Trigger {
  type: "watch";
  cmd: string;
  until: string;
  intervalMs: number;
  maxAttempts: number;
  attempts: number;
}

export interface AwaitTrigger extends Trigger {
  type: "await";
  cmd: string;
  proc: Subprocess | null;
}

type FireCallback = (trigger: Trigger, message: string) => void;

let counter = 0;

function nextId(type: TriggerType): string {
  return `${type}-${++counter}`;
}

export function parseDelay(s: string): number {
  const match = s.match(/^(\d+)(s|m|h)$/);
  if (!match) throw new Error(`Invalid delay: "${s}". Use format like 10s, 5m, 2h`);
  const n = parseInt(match[1]);
  const unit = match[2];
  return n * ({ s: 1000, m: 60_000, h: 3_600_000 }[unit]!);
}

export class TriggerStore {
  private triggers = new Map<string, Trigger>();

  add(trigger: Trigger): void {
    this.triggers.set(trigger.id, trigger);
  }

  remove(id: string): boolean {
    const trigger = this.triggers.get(id);
    if (!trigger) return false;
    trigger.cancel();
    this.triggers.delete(id);
    return true;
  }

  get(id: string): Trigger | undefined {
    return this.triggers.get(id);
  }

  list(): Trigger[] {
    return [...this.triggers.values()];
  }

  clear(): void {
    for (const trigger of this.triggers.values()) {
      trigger.cancel();
    }
    this.triggers.clear();
  }

  createRemind(delayMs: number, prompt: string, onFire: FireCallback): RemindTrigger {
    const id = nextId("remind");
    let timer: ReturnType<typeof setTimeout>;

    const trigger: RemindTrigger = {
      id,
      type: "remind",
      prompt,
      delayMs,
      createdAt: Date.now(),
      cancel: () => clearTimeout(timer),
    };

    timer = setTimeout(() => {
      this.triggers.delete(id);
      onFire(trigger, `Timer fired after ${delayMs}ms: ${prompt}`);
    }, delayMs);

    this.add(trigger);
    return trigger;
  }

  createWatch(
    cmd: string,
    until: string,
    intervalMs: number,
    maxAttempts: number,
    prompt: string,
    onFire: FireCallback,
  ): WatchTrigger {
    const id = nextId("watch");
    let timer: ReturnType<typeof setInterval>;
    let running = false;

    const trigger: WatchTrigger = {
      id,
      type: "watch",
      prompt,
      cmd,
      until,
      intervalMs,
      maxAttempts,
      attempts: 0,
      createdAt: Date.now(),
      cancel: () => clearInterval(timer),
    };

    const poll = async () => {
      if (running) return;
      running = true;
      trigger.attempts++;

      try {
        const proc = spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
        const output = await new Response(proc.stdout).text();
        await proc.exited;

        if (output.trim().includes(until)) {
          clearInterval(timer);
          this.triggers.delete(id);
          onFire(trigger, `Watch condition met (output contains "${until}"): ${prompt}\nOutput: ${output.trim()}`);
          return;
        }
      } catch {
        // poll continues on error
      }

      if (trigger.attempts >= maxAttempts) {
        clearInterval(timer);
        this.triggers.delete(id);
        onFire(trigger, `Watch exhausted ${maxAttempts} attempts without matching "${until}": ${prompt}`);
      }

      running = false;
    };

    // Run first poll immediately, then on interval
    poll();
    timer = setInterval(poll, intervalMs);

    this.add(trigger);
    return trigger;
  }

  createAwait(cmd: string, prompt: string, onFire: FireCallback): AwaitTrigger {
    const id = nextId("await");

    const proc = spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });

    const trigger: AwaitTrigger = {
      id,
      type: "await",
      prompt,
      cmd,
      proc,
      createdAt: Date.now(),
      cancel: () => proc.kill(),
    };

    (async () => {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      // If trigger was cancelled while running, don't fire
      if (!this.triggers.has(id)) return;
      this.triggers.delete(id);
      const status = exitCode === 0 ? "succeeded" : `failed (exit ${exitCode})`;
      const output = (stdout + stderr).trim();
      onFire(trigger, `Command ${status}: ${prompt}\nCommand: ${cmd}${output ? `\nOutput: ${output}` : ""}`);
    })();

    this.add(trigger);
    return trigger;
  }
}

// Reset counter for testing
export function _resetCounter(): void {
  counter = 0;
}
