import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessSupervisor } from "./ProcessSupervisor.js";

const supervisors: ProcessSupervisor[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.stop()));
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(code: string, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "Kortex runtime com espaços "));
  directories.push(dir);
  const entry = path.join(dir, "child.mjs");
  fs.writeFileSync(entry, code);
  const supervisor = new ProcessSupervisor([{ name: "worker", entry, cwd: dir,
    env: { ...process.env, SYNTHETIC_PASSWORD: "never-in-status" } }],
    { minRestartMs: 30, maxRestartMs: 100, shutdownTimeoutMs: 150, ...options });
  supervisors.push(supervisor);
  return { dir, supervisor };
}

describe("background process supervision", () => {
  it("restarts a crashed child and stops the replacement through Windows-compatible IPC", async () => {
    const { supervisor, dir } = fixture(`import fs from "node:fs";
const count = fs.existsSync("attempts.txt") ? Number(fs.readFileSync("attempts.txt", "utf8")) + 1 : 1;
fs.writeFileSync("attempts.txt", String(count));
process.send?.("ready");
if (count === 1) setTimeout(() => process.exit(7), 20);
else {
  setInterval(() => {}, 1000);
  process.on("message", (message) => { if (message === "shutdown") {
    fs.writeFileSync("shutdown.txt", "graceful"); process.exit(0);
  } });
}`);
    supervisor.start();
    await vi.waitFor(() => {
      expect(fs.readFileSync(path.join(dir, "attempts.txt"), "utf8")).toBe("2");
      expect(supervisor.snapshot()[0]?.state).toBe("running");
    });
    expect(supervisor.snapshot()[0]?.restarts).toBe(1);
    expect(JSON.stringify(supervisor.snapshot())).not.toContain("never-in-status");
    await supervisor.stop();
    expect(fs.readFileSync(path.join(dir, "shutdown.txt"), "utf8")).toBe("graceful");
    expect(supervisor.snapshot()[0]?.state).toBe("stopped");
  });

  it("cancels a scheduled restart instead of reviving the worker after stop", async () => {
    const { supervisor, dir } = fixture(`import fs from "node:fs";
fs.appendFileSync("attempts.txt", "started\\n"); process.exit(1);`, { minRestartMs: 250 });
    supervisor.start();
    await vi.waitFor(() => expect(supervisor.snapshot()[0]?.state).toBe("restarting"));
    await supervisor.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fs.readFileSync(path.join(dir, "attempts.txt"), "utf8")).toBe("started\n");
    expect(supervisor.snapshot()[0]?.pid).toBeUndefined();
  });

  it("bounds shutdown when an owned process ignores IPC and SIGTERM", async () => {
    const { supervisor, dir } = fixture(`import fs from "node:fs";
process.on("SIGTERM", () => {}); process.on("message", () => {});
process.send?.("ready");
setInterval(() => {}, 1000); fs.writeFileSync("ready.txt", "ready");`);
    supervisor.start();
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, "ready.txt"))).toBe(true));
    const pid = supervisor.snapshot()[0]?.pid;
    await supervisor.stop();
    expect(() => process.kill(pid!, 0)).toThrow();
    expect(supervisor.snapshot()[0]?.state).toBe("stopped");
  });

  it("does not spawn a second child when start is called twice", async () => {
    const { supervisor, dir } = fixture(`import fs from "node:fs";
fs.appendFileSync("attempts.txt", "started\\n"); setInterval(() => {}, 1000);
process.send?.("ready");
process.on("message", () => process.exit(0));`);
    supervisor.start();
    supervisor.start();
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, "attempts.txt"))).toBe(true));
    expect(fs.readFileSync(path.join(dir, "attempts.txt"), "utf8")).toBe("started\n");
  });
});
