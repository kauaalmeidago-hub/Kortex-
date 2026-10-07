import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { AutomationError } from "../errors.js";

interface LockFile {
  ownerId: string;
  pid: number;
  createdAt: string;
}

export interface BrowserProfileLockHandle {
  lockPath: string;
  release: () => Promise<void>;
}

export class BrowserProfileLock {
  constructor(
    private readonly lockPath: string,
    private readonly ttlMs: number,
  ) {}

  async acquire(ownerId: string): Promise<BrowserProfileLockHandle> {
    await mkdir(path.dirname(this.lockPath), { recursive: true });
    await this.removeStaleLock();

    try {
      const handle = await open(this.lockPath, "wx");
      const payload: LockFile = {
        ownerId,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      };
      await handle.writeFile(JSON.stringify(payload, null, 2), "utf8");
      await handle.close();

      return {
        lockPath: this.lockPath,
        release: async () => {
          await rm(this.lockPath, { force: true }).catch(() => undefined);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new AutomationError("PROFILE_LOCKED", "Perfil Chrome exclusivo do Koa ja esta em uso.", {
        safeDetails: await this.describeCurrentOwner(),
        retryable: true,
      });
    }
  }

  private async removeStaleLock() {
    if (this.ttlMs <= 0) return;

    const lockStat = await stat(this.lockPath).catch(() => undefined);
    if (!lockStat) return;

    const lock = await this.readLockFile();
    if (lock?.pid && !this.isProcessAlive(lock.pid)) {
      await rm(this.lockPath, { force: true }).catch(() => undefined);
      return;
    }

    if (Date.now() - lockStat.mtimeMs > this.ttlMs) {
      await rm(this.lockPath, { force: true }).catch(() => undefined);
    }
  }

  private async readLockFile() {
    const raw = await readFile(this.lockPath, "utf8").catch(() => undefined);
    if (!raw) return undefined;

    try {
      return JSON.parse(raw) as Partial<LockFile>;
    } catch {
      return undefined;
    }
  }

  private isProcessAlive(pid: number) {
    if (!Number.isInteger(pid) || pid <= 0) return false;

    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "EPERM";
    }
  }

  private async describeCurrentOwner() {
    const raw = await readFile(this.lockPath, "utf8").catch(() => undefined);
    if (!raw) return `Lock: ${this.lockPath}`;

    try {
      const parsed = JSON.parse(raw) as Partial<LockFile>;
      return `Lock: ${this.lockPath}. Owner: ${parsed.ownerId ?? "desconhecido"}. PID: ${parsed.pid ?? "desconhecido"}.`;
    } catch {
      return `Lock: ${this.lockPath}`;
    }
  }
}
