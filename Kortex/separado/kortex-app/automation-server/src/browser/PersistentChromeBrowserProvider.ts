import type { AutomationConfig } from "../config.js";
import type { OperationRecord } from "../types.js";
import type { BrowserProvider, BrowserProviderOptions, ManagedBrowserContext } from "./BrowserProvider.js";
import type { KoaBrowserProfileManager } from "./KoaBrowserProfileManager.js";

export class PersistentChromeBrowserProvider implements BrowserProvider {
  constructor(
    private readonly config: AutomationConfig,
    private readonly profileManager: KoaBrowserProfileManager,
  ) {}

  async createContext(operation: OperationRecord, _signal: AbortSignal, options: BrowserProviderOptions): Promise<ManagedBrowserContext> {
    const headless = this.config.browserMode === "onboarding" ? false : this.config.headless;
    const { context, lock } = await this.profileManager.launchPersistentContext({
      ownerId: `operation:${operation.id}`,
      headless,
      downloadsPath: options.downloadsPath,
    });

    const page = context.pages()[0] ?? (await context.newPage());
    return {
      context,
      page,
      close: () => this.profileManager.releasePersistentContext(context, lock),
    };
  }
}
