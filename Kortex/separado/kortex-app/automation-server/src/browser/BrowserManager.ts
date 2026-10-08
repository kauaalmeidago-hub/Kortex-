import { mkdirSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page, Route } from "playwright";
import type { AutomationConfig } from "../config.js";
import type { OperationArtifact, OperationRecord } from "../types.js";
import { DomainAllowlist } from "../security/DomainAllowlist.js";
import { sanitizeUrl } from "../security/redaction.js";
import type { BrowserProvider, ManagedBrowserContext } from "./BrowserProvider.js";
import { createBrowserProvider } from "./createBrowserProvider.js";
import { KoaBrowserProfileManager, type KoaBrowserProfileStatus } from "./KoaBrowserProfileManager.js";
import { SessionManager } from "./SessionManager.js";

export class BrowserManager {
  private readonly profileManager: KoaBrowserProfileManager;
  private readonly sessionManager: SessionManager;
  private readonly provider: BrowserProvider;
  private readonly domainAllowlist: DomainAllowlist;

  constructor(
    private readonly config: AutomationConfig,
    provider?: BrowserProvider,
    profileManager?: KoaBrowserProfileManager,
  ) {
    this.profileManager = profileManager ?? new KoaBrowserProfileManager(config);
    this.sessionManager = new SessionManager(this.profileManager);
    this.provider = provider ?? createBrowserProvider(config, this.profileManager);
    this.domainAllowlist = new DomainAllowlist(config.allowedAutomationHosts);
  }

  async withContext<T>(
    operation: OperationRecord,
    signal: AbortSignal,
    callback: (context: BrowserContext, page: Page) => Promise<T>,
  ) {
    const downloadDir = path.join(this.config.downloadsDir, operation.id);
    mkdirSync(downloadDir, { recursive: true });

    const managed = await this.provider.createContext(operation, signal, { downloadsPath: downloadDir });
    await this.installDomainGuard(managed, operation);

    const abortListener = () => {
      void managed.close().catch(() => undefined);
    };
    signal.addEventListener("abort", abortListener, { once: true });

    try {
      return await callback(managed.context, managed.page);
    } catch (error) {
      const step = this.extractStep(operation, error);
      const errorContext = this.canCaptureErrorScreenshot(step, managed.page)
        ? await this.captureErrorScreenshot(operation, managed.page, step).catch(() => undefined)
        : undefined;
      if (errorContext && error && typeof error === "object") {
        Object.assign(error, { automationErrorContext: errorContext });
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", abortListener);
      await managed.close();
    }
  }

  async getProfileStatus(): Promise<KoaBrowserProfileStatus> {
    return this.profileManager.getStatus();
  }

  async validatePortalSession(portal: "hapvida" | "ndi", page: Page) {
    return this.sessionManager.validateSession(portal, page);
  }

  async saveSession(context: BrowserContext, portal: "hapvida" | "ndi") {
    await this.sessionManager.saveSession(context, portal);
  }

  async invalidateSession(portal: "hapvida" | "ndi") {
    await this.sessionManager.invalidateSession(portal);
  }

  validateAllowedUrl(url: string, operation?: OperationRecord) {
    this.domainAllowlist.assertAllowed(url, operation?.type);
  }

  async captureErrorScreenshot(operation: OperationRecord, page: Page | undefined, step: string) {
    if (!page) return undefined;

    const operationArtifactDir = path.join(this.config.artifactsDir, operation.id);
    mkdirSync(operationArtifactDir, { recursive: true });
    const fileName = `error-${Date.now()}.png`;
    const filePath = path.join(operationArtifactDir, fileName);

    await page.screenshot({ path: filePath, fullPage: true }).catch(() => undefined);

    const artifact: OperationArtifact = {
      id: crypto.randomUUID(),
      fileName,
      path: filePath,
      mimeType: "image/png",
      kind: "screenshot",
      createdAt: new Date().toISOString(),
    };

    return {
      artifact,
      url: sanitizeUrl(page.url()),
      step,
    };
  }

  private extractStep(operation: OperationRecord, error: unknown) {
    if (error && typeof error === "object" && "step" in error && typeof (error as { step?: unknown }).step === "string") {
      return (error as { step: string }).step;
    }

    return operation.currentStep ?? "browser-error";
  }

  private canCaptureErrorScreenshot(step: string, page: Page | undefined) {
    if (this.config.traceAuth) return true;
    const url = page?.url() ?? "";
    return !/(auth|autentic|login|senha|password|signin|sign-in)/i.test(`${step} ${url}`);
  }

  private async installDomainGuard(managed: ManagedBrowserContext, operation: OperationRecord) {
    await managed.context.route("**/*", async (route: Route) => {
      const request = route.request();
      const url = request.url();
      let allowed = this.domainAllowlist.isAllowed(url);

      if (!allowed && operation.type === "CARD_ISSUE") {
        try {
          const frame = request.frame();
          const page = frame.page();
          const topLevelNavigation = request.isNavigationRequest() && frame === page.mainFrame();
          allowed = !topLevelNavigation && this.domainAllowlist.isAllowedCardRecaptchaResource(url, page.url(), operation.portal);
        } catch {
          // Requests without an owning page do not receive this exception.
        }
      }

      if (allowed) {
        await route.fallback();
        return;
      }

      await route.abort("blockedbyclient");
    });

    for (const page of managed.context.pages()) {
      this.attachPageNavigationGuard(page);
    }

    managed.context.on("page", (page) => this.attachPageNavigationGuard(page));
  }

  private attachPageNavigationGuard(page: Page) {
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      if (!this.domainAllowlist.isAllowed(frame.url())) {
        void page.close().catch(() => undefined);
      }
    });
  }
}

