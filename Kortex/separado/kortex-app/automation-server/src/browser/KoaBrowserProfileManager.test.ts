import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AutomationConfig } from "../config.js";
import { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";

async function createConfig(): Promise<AutomationConfig> {
  const root = await mkdtemp(path.join(os.tmpdir(), "koa-profile-manager-"));
  const dataDir = path.join(root, "data");

  return {
    host: "127.0.0.1",
    port: 4777,
    apiToken: "test",
    repositoryMode: "sqlite",
    automationMode: "api-worker",
    artifactBucket: "koa-artifacts",
    secretProviderMode: "mock",
    workerId: "test-worker",
    workerLeaseSeconds: 60,
    workerPollIntervalMs: 3000,
    workerHeartbeatIntervalMs: 25000,
    debug: false,
    headless: true,
    browserProvider: "persistent-chrome",
    browserMode: "automation",
    browserDebug: false,
    browserStatusPath: path.join(root, "browser-profile-status.json"),
    allowedAutomationHosts: ["webhap.hapvida.com.br", "sigo.sh.srv.br"],
    profileLockTtlMs: 1000,
    traceAuth: false,
    actionTimeoutMs: 1000,
    navigationTimeoutMs: 1000,
    authTimeoutMs: 1000,
    downloadTimeoutMs: 1000,
    features: {
      cardIssue: true,
      cardIssueBatch: false,
      inclusion: false,
      exclusion: false,
    },
    automationRoot: root,
    authDir: path.join(root, ".auth"),
    browserProfileDir: path.join(root, "browser-profile"),
    dataDir,
    artifactsDir: path.join(dataDir, "artifacts"),
    downloadsDir: path.join(dataDir, "downloads"),
    secretsDir: path.join(root, "secrets"),
    databasePath: path.join(dataDir, "operations.sqlite"),
    hapvidaPortalUrl: "https://example.com",
    hapvidaAuthenticatedSelector: "[data-authenticated]",
  };
}

describe("KoaBrowserProfileManager", () => {
  it("keeps profile metadata without storing secrets", async () => {
    const manager = new KoaBrowserProfileManager(await createConfig());

    await manager.writeStatus({
      initialized: true,
      hapvidaSessionValidated: true,
      lastValidatedAt: "2026-10-06T00:00:00.000Z",
    });

    const status = await manager.getStatus();
    expect(status).toMatchObject({
      initialized: true,
      hapvidaSessionValidated: true,
    });
    expect(JSON.stringify(status)).not.toMatch(/password|senha|token|cookie/i);
  });

  it("tracks local storageState presence by path only", async () => {
    const config = await createConfig();
    const manager = new KoaBrowserProfileManager(config);
    await manager.ensureProfileDir();
    await mkdir(config.authDir, { recursive: true });
    await writeFile(manager.getAuthStatePath("hapvida"), "{}", "utf8");

    expect(manager.hasAuthState("hapvida")).toBe(true);
    expect(manager.getAuthStatePath("hapvida")).toContain(".auth");
  });
});
