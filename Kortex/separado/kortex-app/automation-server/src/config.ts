import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLocalApiToken } from "./security/localToken.js";

export interface AutomationConfig {
  host: string;
  port: number;
  apiToken: string;
  databaseUrl?: string;
  repositoryMode: "sqlite" | "postgres";
  automationMode: "api-worker" | "api" | "worker" | "local-worker";
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  artifactBucket: string;
  secretProviderMode: "dpapi" | "remote" | "mock";
  workerId: string;
  workerLeaseSeconds: number;
  workerPollIntervalMs: number;
  workerHeartbeatIntervalMs: number;
  debug: boolean;
  headless: boolean;
  browserProvider: "persistent-chrome" | "headless-chromium" | "headless-local";
  browserMode: "background" | "debug" | "onboarding" | "automation";
  browserDebug: boolean;
  browserChannel?: string;
  browserStatusPath: string;
  existingChromeCdpUrl?: string;
  allowedAutomationHosts: string[];
  profileLockTtlMs: number;
  traceAuth: boolean;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
  authTimeoutMs: number;
  downloadTimeoutMs: number;
  features: {
    cardIssue: boolean;
    cardIssueBatch: boolean;
    inclusion: boolean;
    exclusion: boolean;
  };
  automationRoot: string;
  authDir: string;
  browserProfileDir: string;
  dataDir: string;
  artifactsDir: string;
  downloadsDir: string;
  secretsDir: string;
  databasePath: string;
  hapvidaPortalUrl?: string;
  hapvidaCardPortalUrl?: string;
  ndiCardPortalUrl?: string;
  hapvidaAuthenticatedSelector?: string;
}

export function booleanEnv(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "sim"].includes(value.toLowerCase());
}

function optionalEnv(value: string | undefined) {
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function listEnv(value: string | undefined, fallback: string[]) {
  if (!value?.trim()) return fallback;
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function numberEnv(value: string | undefined, fallback: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function defaultKoaBrowserProfileDir() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "Kortex", "KoaBrowserProfile");
  }

  return path.join(os.homedir(), ".kortex", "KoaBrowserProfile");
}

let envFilesLoaded = false;

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === `"` || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(filePath: string, shellEnvKeys: Set<string>) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = assignment.indexOf("=");
    if (separator <= 0) continue;

    const key = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (shellEnvKeys.has(key)) continue;

    process.env[key] = unquoteEnvValue(assignment.slice(separator + 1));
  }
}

function loadLocalEnvFiles() {
  if (envFilesLoaded) return;
  envFilesLoaded = true;

  const shellEnvKeys = new Set(Object.keys(process.env));
  loadEnvFile(path.resolve(process.cwd(), ".env"), shellEnvKeys);
  loadEnvFile(path.resolve(process.cwd(), ".env.local"), shellEnvKeys);
}

export function loadConfig(): AutomationConfig {
  loadLocalEnvFiles();

  const automationRoot = path.resolve(process.env.KOA_AUTOMATION_HOME ?? path.join(process.cwd(), "automation"));
  const authDir = path.join(automationRoot, ".auth");
  const browserProfileDir = path.resolve(process.env.KOA_BROWSER_PROFILE_DIR ?? defaultKoaBrowserProfileDir());
  const browserStatusPath = path.join(automationRoot, "browser-profile-status.json");
  const dataDir = path.join(automationRoot, "data");
  const artifactsDir = path.join(dataDir, "artifacts");
  const downloadsDir = path.join(dataDir, "downloads");
  const secretsDir = path.join(automationRoot, "secrets");

  for (const dir of [automationRoot, authDir, browserProfileDir, dataDir, artifactsDir, downloadsDir, secretsDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const host = process.env.KOA_AUTOMATION_HOST ?? "127.0.0.1";
  if (host === "0.0.0.0") {
    throw new Error("KOA_AUTOMATION_HOST=0.0.0.0 is blocked for this local MVP. Use 127.0.0.1.");
  }

  const debug = booleanEnv(process.env.KOA_AUTOMATION_DEBUG, false);
  const browserDebug = booleanEnv(process.env.KOA_BROWSER_DEBUG, debug);
  const browserMode = (process.env.KOA_BROWSER_MODE as AutomationConfig["browserMode"]) ?? "background";
  const headless = booleanEnv(process.env.KOA_AUTOMATION_HEADLESS ?? process.env.HEADLESS, !browserDebug);
  const requestedProvider = process.env.BROWSER_PROVIDER as AutomationConfig["browserProvider"] | undefined;
  const browserProvider =
    requestedProvider ?? (browserMode === "onboarding" || browserMode === "debug" ? "persistent-chrome" : "headless-local");

  return {
    host,
    port: Number(process.env.KOA_AUTOMATION_PORT ?? 4777),
    apiToken: ensureLocalApiToken(secretsDir),
    databaseUrl: process.env.DATABASE_URL,
    repositoryMode: process.env.DATABASE_URL ? "postgres" : "sqlite",
    automationMode: (process.env.AUTOMATION_MODE as AutomationConfig["automationMode"]) ?? "api-worker",
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    artifactBucket: process.env.ARTIFACT_BUCKET ?? "koa-artifacts",
    secretProviderMode: (process.env.SECRET_PROVIDER as AutomationConfig["secretProviderMode"]) ?? "dpapi",
    workerId: process.env.KOA_WORKER_ID ?? process.env.WORKER_ID ?? `local-${process.pid}`,
    workerLeaseSeconds: Number(process.env.WORKER_LEASE_SECONDS ?? 60),
    workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3000),
    workerHeartbeatIntervalMs: numberEnv(process.env.WORKER_HEARTBEAT_INTERVAL_MS, 25_000),
    debug,
    headless: browserMode === "background" ? true : headless,
    browserProvider,
    browserMode,
    browserDebug,
    browserChannel: optionalEnv(process.env.KOA_BROWSER_CHANNEL) ?? "chrome",
    browserStatusPath,
    existingChromeCdpUrl: optionalEnv(process.env.KOA_EXISTING_CHROME_CDP_URL),
    allowedAutomationHosts: listEnv(process.env.KOA_AUTOMATION_ALLOWED_HOSTS, [
      "webhap.hapvida.com.br",
      "sigo.sh.srv.br",
    ]),
    profileLockTtlMs: numberEnv(process.env.KOA_BROWSER_PROFILE_LOCK_TTL_MS, 12 * 60 * 60 * 1000),
    traceAuth: booleanEnv(process.env.TRACE_AUTH, false),
    actionTimeoutMs: numberEnv(process.env.KOA_BROWSER_ACTION_TIMEOUT_MS, 30_000),
    navigationTimeoutMs: numberEnv(process.env.KOA_BROWSER_NAVIGATION_TIMEOUT_MS, 45_000),
    authTimeoutMs: numberEnv(process.env.KOA_BROWSER_AUTH_TIMEOUT_MS, 20_000),
    downloadTimeoutMs: numberEnv(process.env.KOA_BROWSER_DOWNLOAD_TIMEOUT_MS, 60_000),
    features: {
      cardIssue: booleanEnv(process.env.FEATURE_KOA_CARD_ISSUE ?? process.env.KOA_CARD_ISSUE_ENABLED, true),
      cardIssueBatch: booleanEnv(process.env.KOA_CARD_ISSUE_BATCH_ENABLED, false),
      inclusion: booleanEnv(process.env.FEATURE_KOA_INCLUSION ?? process.env.KOA_INCLUSION_ENABLED, false),
      exclusion: booleanEnv(process.env.FEATURE_KOA_EXCLUSION ?? process.env.KOA_EXCLUSION_ENABLED, false),
    },
    automationRoot,
    authDir,
    browserProfileDir,
    dataDir,
    artifactsDir,
    downloadsDir,
    secretsDir,
    databasePath: path.join(dataDir, "operations.sqlite"),
    hapvidaPortalUrl: optionalEnv(process.env.HAPVIDA_CARD_PORTAL_URL) ?? optionalEnv(process.env.HAPVIDA_PORTAL_URL),
    hapvidaCardPortalUrl: optionalEnv(process.env.HAPVIDA_CARD_PORTAL_URL) ?? optionalEnv(process.env.HAPVIDA_PORTAL_URL),
    ndiCardPortalUrl: optionalEnv(process.env.NDI_CARD_PORTAL_URL),
    hapvidaAuthenticatedSelector: optionalEnv(process.env.HAPVIDA_AUTHENTICATED_SELECTOR),
  };
}
