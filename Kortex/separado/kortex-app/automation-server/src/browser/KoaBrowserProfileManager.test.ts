import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
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
      exclusionPreview: false,
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

  it("validates the NDI card session without accepting a Hapvida page or resetting Hapvida status", async () => {
    const config = await createConfig();
    config.ndiCardPortalUrl = "https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form";
    const manager = new KoaBrowserProfileManager(config);
    await manager.markSessionValidated("hapvida");
    const wait = vi.fn(async () => undefined);
    const page = { url: () => config.ndiCardPortalUrl!, getByText: () => ({ first: () => ({ waitFor: wait }) }) } as unknown as Page;
    expect(await manager.validatePortalSession("ndi", page)).toBe(true);
    expect(await manager.getStatus()).toMatchObject({ hapvidaSessionValidated: true, ndiSessionValidated: true });
    page.url = () => "https://webhap.hapvida.com.br/pls/webhap/period";
    expect(await manager.validatePortalSession("ndi", page)).toBe(false);
    expect(wait).toHaveBeenCalledOnce();
    expect(await manager.getStatus()).toMatchObject({ hapvidaSessionValidated: true, ndiSessionValidated: false });
  });

  it("loads the NDI storage state without reading a Hapvida session", async () => {
    const config = await createConfig(); const manager = new KoaBrowserProfileManager(config);
    await manager.ensureProfileDir();
    await writeFile(manager.getAuthStatePath("ndi"), JSON.stringify({ cookies: [], origins: [] }), "utf8");
    expect(await manager.readStorageState("ndi")).toEqual({ cookies: [], origins: [] });
    expect(await manager.readStorageState("hapvida")).toBeUndefined();
    expect(await manager.getStatus()).toMatchObject({ initialized: true, hapvidaSessionValidated: false });
  });
});

