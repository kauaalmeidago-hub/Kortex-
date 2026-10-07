import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserProfileLock } from "./BrowserProfileLock.js";

describe("BrowserProfileLock", () => {
  it("allows only one owner until the lock is released", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "koa-profile-lock-"));
    const lock = new BrowserProfileLock(path.join(dir, ".koa-profile.lock"), 0);

    const first = await lock.acquire("first");
    await expect(lock.acquire("second")).rejects.toMatchObject({ code: "PROFILE_LOCKED" });

    await first.release();
    const second = await lock.acquire("second");
    await second.release();
  });

  it("recovers a lock left by a dead process", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "koa-profile-lock-"));
    const lockPath = path.join(dir, ".koa-profile.lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        ownerId: "previous-owner",
        pid: 999999,
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    const lock = new BrowserProfileLock(lockPath, 60_000);
    const handle = await lock.acquire("next-owner");
    await handle.release();
  });
});
