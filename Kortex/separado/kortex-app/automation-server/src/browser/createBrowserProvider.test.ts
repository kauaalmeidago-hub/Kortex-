import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AutomationConfig } from "../config.js";
import { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";
import { createBrowserProvider } from "./createBrowserProvider.js";

async function createConfig(overrides: Partial<AutomationConfig> = {}): Promise<AutomationConfig> {
  const root = await mkdtemp(path.join(os.tmpdir(), "koa-browser-provider-"));
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
    browserProvider: "headless-local",
    browserMode: "background",
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
    ...overrides,
  };
}

describe("createBrowserProvider", () => {
  it("rejects persistent Chrome in background mode", async () => {
    const config = await createConfig({ browserProvider: "persistent-chrome" });
    const manager = new KoaBrowserProfileManager(config);

    expect(() => createBrowserProvider(config, manager)).toThrow(/background exige/);
  });
});
