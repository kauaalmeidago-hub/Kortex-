import { chromium } from "playwright";
import type { AutomationConfig } from "../config.js";
import type { OperationRecord } from "../types.js";
import type { BrowserProvider, BrowserProviderOptions, ManagedBrowserContext } from "./BrowserProvider.js";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";

export class HeadlessLocalBrowserProvider implements BrowserProvider {
  constructor(
    private readonly config: AutomationConfig,
    private readonly profileManager: KoaBrowserProfileManager,
  ) {}

  async createContext(operation: OperationRecord, _signal: AbortSignal, options: BrowserProviderOptions): Promise<ManagedBrowserContext> {
    const launchOptions: NonNullable<Parameters<typeof chromium.launch>[0]> = {
      downloadsPath: options.downloadsPath,
      headless: true,
    };

    if (this.config.browserChannel) {
      launchOptions.channel = this.config.browserChannel;
    }

    const browser = await chromium.launch(launchOptions);
    const storageState = await this.profileManager.readStorageState(operation.portal);
    const context = await browser.newContext({
      acceptDownloads: true,
      storageState,
      viewport: { width: 1366, height: 900 },
    });
    context.setDefaultTimeout(this.config.actionTimeoutMs);
    context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    const page = await context.newPage();
    return {
      context,
      page,
      close: async () => {
        await this.profileManager.saveSession(context, operation.portal).catch(() => undefined);
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
    };
  }
}

