import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AutomationConfig } from "../config.js";
import { AutomationError } from "../errors.js";
import { protectWithDpapi, unprotectWithDpapi } from "../security/DpapiProtector.js";
import { BrowserProfileLock, type BrowserProfileLockHandle } from "./BrowserProfileLock.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface KoaBrowserProfileStatus {
  profileDir: string;
  initialized: boolean;
  hapvidaSessionValidated: boolean;
  lastValidatedAt?: string;
  lastValidationError?: string;
  onboardingOpenedAt?: string;
  updatedAt?: string;
}

interface PersistentContextOptions {
  ownerId: string;
  headless: boolean;
  downloadsPath?: string;
}

export class KoaBrowserProfileManager {
  private readonly lock: BrowserProfileLock;

  constructor(private readonly config: AutomationConfig) {
    this.lock = new BrowserProfileLock(path.join(config.browserProfileDir, ".koa-profile.lock"), config.profileLockTtlMs);
  }

  get profileDir() {
    return this.config.browserProfileDir;
  }

  get statusPath() {
    return this.config.browserStatusPath;
  }

  getAuthStatePath(portal = "hapvida") {
    return path.join(this.config.authDir, `${portal}-storage-state.json`);
  }

  getProtectedAuthStatePath(portal = "hapvida") {
    return path.join(this.config.authDir, `${portal}-storage-state.dpapi`);
  }

  hasAuthState(portal = "hapvida") {
    return existsSync(this.getProtectedAuthStatePath(portal)) || existsSync(this.getAuthStatePath(portal));
  }

  async ensureProfileDir() {
    await mkdir(this.config.browserProfileDir, { recursive: true });
    await mkdir(this.config.authDir, { recursive: true });
    await mkdir(path.dirname(this.config.browserStatusPath), { recursive: true });
  }

  async getStatus(): Promise<KoaBrowserProfileStatus> {
    await this.ensureProfileDir();
    const raw = await readFile(this.config.browserStatusPath, "utf8").catch(() => undefined);
    if (!raw) {
      return {
        profileDir: this.config.browserProfileDir,
        initialized: this.hasAuthState("hapvida"),
        hapvidaSessionValidated: false,
      };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<KoaBrowserProfileStatus>;
      const authStateExists = this.hasAuthState("hapvida");
      return {
        ...parsed,
        profileDir: this.config.browserProfileDir,
        initialized: parsed.initialized ?? authStateExists,
        hapvidaSessionValidated: parsed.hapvidaSessionValidated ?? false,
      };
    } catch {
      return {
        profileDir: this.config.browserProfileDir,
        initialized: this.hasAuthState("hapvida"),
        hapvidaSessionValidated: false,
        lastValidationError: "browser-profile-status.json invalido.",
      };
    }
  }

  async writeStatus(patch: Partial<KoaBrowserProfileStatus>) {
    const current = await this.getStatus();
    const next: KoaBrowserProfileStatus = {
      ...current,
      ...patch,
      profileDir: this.config.browserProfileDir,
      initialized: patch.initialized ?? current.initialized,
      hapvidaSessionValidated: patch.hapvidaSessionValidated ?? current.hapvidaSessionValidated,
      updatedAt: new Date().toISOString(),
    };

    await writeFile(this.config.browserStatusPath, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  async launchPersistentContext(options: PersistentContextOptions) {
    await this.ensureProfileDir();
    const lock = await this.lock.acquire(options.ownerId);

    try {
      const launchOptions: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> = {
        acceptDownloads: true,
        downloadsPath: options.downloadsPath,
        headless: options.headless,
        viewport: { width: 1366, height: 900 },
        slowMo: this.config.browserDebug ? 50 : undefined,
      };

      if (this.config.browserChannel) {
        launchOptions.channel = this.config.browserChannel;
      }

      const context = await chromium.launchPersistentContext(this.config.browserProfileDir, launchOptions);
      context.setDefaultTimeout(this.config.actionTimeoutMs);
      context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
      return { context, lock };
    } catch (error) {
      await lock.release();
      throw error;
    }
  }

  async saveSession(context: BrowserContext, portal = "hapvida") {
    const storageState = await context.storageState();
    await this.saveStorageState(portal, storageState);
    await this.writeStatus({
      initialized: true,
    });
  }

  async saveStorageState(portal = "hapvida", storageState: StorageState) {
    await this.ensureProfileDir();
    const encrypted = await protectWithDpapi(JSON.stringify(storageState));
    await writeFile(this.getProtectedAuthStatePath(portal), encrypted, "utf8");
    await rm(this.getAuthStatePath(portal), { force: true }).catch(() => undefined);
  }

  async readStorageState(portal = "hapvida"): Promise<StorageState | undefined> {
    await this.ensureProfileDir();
    const protectedPath = this.getProtectedAuthStatePath(portal);
    if (existsSync(protectedPath)) {
      const encrypted = (await readFile(protectedPath, "utf8")).trim();
      return JSON.parse(await unprotectWithDpapi(encrypted)) as StorageState;
    }

    const legacyPath = this.getAuthStatePath(portal);
    if (existsSync(legacyPath)) {
      const raw = await readFile(legacyPath, "utf8");
      return JSON.parse(raw) as StorageState;
    }

    return undefined;
  }

  async markSessionValidated(portal = "hapvida") {
    await this.writeStatus({
      initialized: true,
      hapvidaSessionValidated: portal === "hapvida" ? true : undefined,
      lastValidatedAt: new Date().toISOString(),
      lastValidationError: undefined,
    });
  }

  async invalidateSession(portal = "hapvida") {
    await rm(this.getAuthStatePath(portal), { force: true }).catch(() => undefined);
    await rm(this.getProtectedAuthStatePath(portal), { force: true }).catch(() => undefined);
    await this.writeStatus({
      initialized: this.hasAuthState(portal),
      hapvidaSessionValidated: portal === "hapvida" ? false : undefined,
      lastValidationError: "Sessao invalidada.",
    });
  }

  async validatePortalSession(portal: "hapvida", page: Page) {
    if (portal !== "hapvida") {
      throw new AutomationError("PORTAL_NOT_SUPPORTED", "Portal nao suportado para validacao de sessao.", {
        safeDetails: `Portal: ${portal}`,
        retryable: false,
      });
    }

    return this.validateHapvidaSession(page);
  }

  private async validateHapvidaSession(page: Page) {
    if (!this.config.hapvidaAuthenticatedSelector) {
      throw new AutomationError("SESSION_VALIDATION_NOT_CONFIGURED", "Validacao de sessao Hapvida nao configurada.", {
        safeDetails: "Configure HAPVIDA_AUTHENTICATED_SELECTOR com um seletor visivel somente apos login.",
        retryable: false,
      });
    }

    if (this.config.hapvidaPortalUrl && page.url() === "about:blank") {
      await page.goto(this.config.hapvidaPortalUrl, { waitUntil: "domcontentloaded" });
    }

    try {
      await page.locator(this.config.hapvidaAuthenticatedSelector).first().waitFor({
        state: "visible",
        timeout: this.config.authTimeoutMs,
      });
      await this.writeStatus({
        initialized: true,
        hapvidaSessionValidated: true,
        lastValidatedAt: new Date().toISOString(),
        lastValidationError: undefined,
      });
      return true;
    } catch (error) {
      await this.writeStatus({
        hapvidaSessionValidated: false,
        lastValidationError: error instanceof Error ? error.message : "Sessao Hapvida invalida.",
      });
      return false;
    }
  }

  async releasePersistentContext(context: BrowserContext, lock: BrowserProfileLockHandle, saveState = true) {
    try {
      if (saveState) {
        await this.saveSession(context, "hapvida").catch(() => undefined);
      }
      await context.close().catch(() => undefined);
    } finally {
      await lock.release();
    }
  }
}
